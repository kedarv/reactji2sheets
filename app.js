import envSchema from 'env-schema';
import pkg from '@slack/bolt';
import { Sequelize, DataTypes } from 'sequelize';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyEnv from '@fastify/env';
import axios from 'axios';
import { write } from './sheets.js';
const { App } = pkg;

const schema = {
    type: 'object',
    required: [
        'SLACK_SIGNING_SECRET',
        'SLACK_APP_TOKEN',
        'DB_PATH',
        'FASTIFY_PORT',
        'SLACK_CLIENT_ID',
        'SLACK_CLIENT_SECRET',
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
        FASTIFY_PORT: {
            type: 'number',
        },
        SLACK_CLIENT_ID: {
            type: 'string',
        },
        SLACK_CLIENT_SECRET: {
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
    if(Object.keys(startedWorkspaces).includes(workspace.team_id)) {
        console.log("aborting duplicate listener");
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

                if (!recording) {
                    const user_result = await client.users.info({
                        user: message.user,
                    });
                    await write(
                        event.item.ts,
                        event.item.channel,
                        message.text,
                        user_result.user.name,
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
                'reactji2sheets transits Slack messages to Google Sheets. Use /reactji2sheets :emoji: <spreadsheet_id> to register the current channel with an emoji and spreadsheet pairing.'
            );
        } else if (text.includes('register')) {
            const parts = text.split(' ');
            if (parts.length != 3) {
                await respond(
                    'Oops! Expected register command to contain an emoji. Sample usage: `/reactji2sheets :wave: <spreadsheet_id>`'
                );
            } else {
                try {
                    await Mappings.create({
                        channel: command.channel_id,
                        emoji: parts[1].slice(1, -1),
                        spreadsheet_id: parts[2],
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
const workspaces = await Workspaces.findAll();
for (const workspace of workspaces) {
    await startWorkspace(workspace);
}

const fastify = Fastify({
    logger: true,
});
await fastify.register(cors);
await fastify.after();
fastify.get('/', async (request, reply) => {
    return 'reactji2sheets is running';
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

(async () => {
    await fastify.listen({ port: config.FASTIFY_PORT, host: '0.0.0.0' });
})();
