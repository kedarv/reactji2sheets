import envSchema from 'env-schema';
import pkg from '@slack/bolt';
import { Sequelize, DataTypes } from 'sequelize';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import axios from 'axios';
import {
    write,
    getGoogleAuthorizationUrl,
    exchangeCodeForTokens,
} from './sheets.js';
const { App } = pkg;

const schema = {
    type: 'object',
    required: [
        'SLACK_SIGNING_SECRET',
        'SLACK_APP_TOKEN',
        'DB_PATH',
        'PORT',
        'SLACK_CLIENT_ID',
        'SLACK_CLIENT_SECRET',
        'GOOGLE_APIS_CLIENT_ID',
        'GOOGLE_APIS_CLIENT_SECRET',
        'GOOGLE_APIS_REDIRECT_URL',
    ],
    properties: {
        SLACK_SIGNING_SECRET: {
            type: 'string',
        },
        SLACK_APP_TOKEN: {
            type: 'string',
        },
        DB_PATH: {
            type: 'string',
        },
        PORT: {
            type: 'number',
        },
        SLACK_CLIENT_ID: {
            type: 'string',
        },
        SLACK_CLIENT_SECRET: {
            type: 'string',
        },
        GOOGLE_APIS_CLIENT_ID: {
            type: 'string',
        },
        GOOGLE_APIS_CLIENT_SECRET: {
            type: 'string',
        },
        GOOGLE_APIS_REDIRECT_URL: {
            type: 'string',
        },
    },
};
const config = envSchema({
    schema: schema,
    data: process.env,
    dotenv: true,
});

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: config.DB_PATH,
    sync: true,
    logging: false,
});

const SlackUserToSheetsToken = sequelize.define(
    'SlackUserToSheetsToken',
    {
        connector_user_id: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        token: {
            type: DataTypes.STRING,
            allowNull: false,
        },
    },
    {
        uniqueKeys: {
            Items_unique: {
                fields: ['connector_user_id'],
            },
        },
    }
);

const Mappings = sequelize.define(
    'Mappings',
    {
        id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            allowNull: false,
            primaryKey: true,
        },
        channel: DataTypes.STRING,
        emoji: DataTypes.STRING,
        spreadsheet_id: DataTypes.STRING,
        connector_user_id: DataTypes.STRING,
    },
    {
        uniqueKeys: {
            Items_unique: {
                fields: ['channel', 'emoji'],
            },
        },
        defaultScope: {
            attributes: { exclude: ['id'] },
        },
    }
);

const Recordings = sequelize.define(
    'Recordings',
    {
        client_msg_id: DataTypes.STRING,
    },
    {
        uniqueKeys: {
            Items_unique: {
                fields: ['client_msg_id'],
            },
        },
    }
);

const Workspaces = sequelize.define(
    'Workspaces',
    {
        team_id: DataTypes.STRING,
        name: DataTypes.STRING,
        token: DataTypes.STRING,
    },
    {
        uniqueKeys: {
            Items_unique: {
                fields: ['team_id'],
            },
        },
    }
);

await sequelize.sync();
const startedWorkspaces = {};

const startWorkspace = async (workspace) => {
    if (Object.keys(startedWorkspaces).includes(workspace.team_id)) {
        console.log('aborting duplicate listener');
        return;
    }

    const app = new App({
        token: workspace.token,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        socketMode: true,
        appToken: process.env.SLACK_APP_TOKEN,
    });

    app.event('reaction_added', async ({ event, client, say }) => {
        const mapping = await Mappings.findOne({
            where: {
                channel: event.item.channel,
                emoji: event.reaction,
            },
        });

        if (mapping) {
            try {
                const result = await client.conversations.history({
                    channel: event.item.channel,
                    latest: event.item.ts,
                    inclusive: true,
                    limit: 1,
                });

                const message = result.messages[0];

                const recording = await Recordings.findOne({
                    where: {
                        client_msg_id: message.client_msg_id,
                    },
                });

                const googleCreds = await SlackUserToSheetsToken.findOne({
                    where: { connector_user_id: message.user },
                });

                if (!recording && googleCreds) {
                    const user_result = await client.users.info({
                        user: message.user,
                    });
                    const permalink = await client.chat.getPermalink({
                        message_ts: event.item.ts,
                        channel: event.item.channel
                    });
                    
                    await write(
                        googleCreds.token,
                        event.item.ts,
                        event.item.channel,
                        message.text,
                        user_result.user.name,
                        permalink,
                        mapping.spreadsheet_id
                    );
                    await Recordings.create({
                        client_msg_id: message.client_msg_id,
                    });
                    await say({
                        text: `<@${event.user}>: Recorded :thumbsup:`,
                        thread_ts: event.item.ts,
                    });
                } else {
                    await say({
                        text: `<@${event.user}>: I already recorded this!`,
                        thread_ts: event.item.ts,
                    });
                }
            } catch (e) {
                console.log('error:', e);
            }
        }
    });

    app.command('/reactji2sheets', async ({ command, ack, respond }) => {
        await ack();
        const text = command.text;
        if (text != 'help' && !text.includes('register')) {
            await respond(
                "I don't know how to parse that. Use `help` for more."
            );
        } else if (text == 'help') {
            await respond(
                'reactji2sheets transits Slack messages to Google Sheets. Use /reactji2sheets register :emoji: <spreadsheet_id> to register the current channel with an emoji and spreadsheet pairing.'
            );
        } else if (text.includes('register')) {
            const parts = text.split(' ');
            if (parts.length != 3) {
                await respond(
                    'Oops! Expected register command to contain an emoji. Sample usage: `/reactji2sheets register :wave: <spreadsheet_id>`'
                );
            } else {
                try {
                    let userConnector = await SlackUserToSheetsToken.findOne({
                        where: { connector_user_id: command.user_id },
                    });
                    if (!userConnector) {
                        const url = getGoogleAuthorizationUrl(command.user_id);
                        await respond(
                            `You need to connect to <${url}|Google Sheets first>.`
                        );
                        return;
                    }
                    await Mappings.create({
                        channel: command.channel_id,
                        emoji: parts[1].slice(1, -1),
                        spreadsheet_id: parts[2],
                        connector_user_id: command.user_id,
                    });
                    await respond(
                        `Ok! I've registered ${parts[1]} for the channel <#${command.channel_id}>.`
                    );
                } catch (error) {
                    if (error.name === 'SequelizeUniqueConstraintError') {
                        await respond(
                            `Oops! I already registered ${parts[1]} for <#${command.channel_id}>.`
                        );
                    }
                }
            }
        }
    });
    (async () => {
        await app.start();
        startedWorkspaces[workspace.team_id] = app;
        console.log(
            `started for workspace ${workspace.team_id} (${workspace.name})`
        );
    })();
};

const fastify = Fastify({
    logger: true,
});
await fastify.register(cors);
fastify.register(fastifyView, {
    engine: {
        ejs: ejs,
    }
})
await fastify.after();

fastify.get('/', (request, reply) => {
    reply.view("/templates/home.ejs", { text: "text" });
});

fastify.get('/privacy', (request, reply) => {
    reply.view("/templates/privacy_policy.ejs", { text: "text" });
});

fastify.get('/googleauth', async (request, reply) => {
    if (request.query.code && request.query.state) {
        const user_id = JSON.parse(request.query.state).user_id;
        const tokens = await exchangeCodeForTokens(request.query.code);

        await SlackUserToSheetsToken.create({
            connector_user_id: user_id,
            token: JSON.stringify(tokens),
        });
        return 'woot! it worked, go back to Slack and register your reactji';
    }
    return 'something went wrong';
});

fastify.get('/oauth', async (request, reply) => {
    const oauth_res = await axios.get('https://slack.com/api/oauth.v2.access', {
        params: {
            code: request.query.code,
            client_id: config.SLACK_CLIENT_ID,
            client_secret: config.SLACK_CLIENT_SECRET,
        },
    });
    if (oauth_res.data.ok == true) {
        let authed_workspace = await Workspaces.findOne({
            where: {
                team_id: oauth_res.data.team.id,
            },
        });
        if (!authed_workspace) {
            authed_workspace = await Workspaces.create({
                team_id: oauth_res.data.team.id,
                token: oauth_res.data.access_token,
                name: oauth_res.data.team.name,
            });
        } else {
            authed_workspace.token = oauth_res.data.access_token;
            authed_workspace.save();
        }
        await startWorkspace(authed_workspace);
        return 'authed, you may close this page.';
    }
    return 'something went wrong';
});

const workspaces = await Workspaces.findAll();

for (const workspace of workspaces) {
    await startWorkspace(workspace);
}

(async () => {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
})();
