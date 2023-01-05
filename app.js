import envSchema from 'env-schema';
import pkg from '@slack/bolt';
import { Sequelize, DataTypes } from 'sequelize';
const { App } = pkg;

const schema = {
    type: 'object',
    required: [
        'SLACK_SIGNING_SECRET',
        'SLACK_BOT_TOKEN',
        'SLACK_APP_TOKEN',
        'DB_PATH',
    ],
    properties: {
        SLACK_SIGNING_SECRET: {
            type: 'string',
        },
        SLACK_BOT_TOKEN: {
            type: 'string',
        },
        SLACK_APP_TOKEN: {
            type: 'string',
        },
        DB_PATH: {
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
sequelize.sync();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
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

            // TODO: write to Gsheetes
            console.log('message:', message);
            await say({
                text: `Recorded :thumbsup:`,
                thread_ts: event.item.ts,
            });
        } catch (e) {
            console.log('error:', e);
        }
    }
});

app.command('/reactji2sheets', async ({ command, ack, respond }) => {
    await ack();
    const text = command.text;
    if (text != 'help' && !text.includes('register')) {
        await respond("I don't know how to parse that. Use `help` for more.");
    } else if (text == 'help') {
        await respond(
            'reactji2sheets transits Slack messages to Google Sheets. Use /reactji2sheets :emoji: to register the current channel and emoji pairing.'
        );
    } else if (text.includes('register')) {
        const parts = text.split(' ');
        if (parts.length != 2) {
            await respond(
                'Oops! Expected register command to contain an emoji. Sample usage: `/reactji2sheets :wave:`'
            );
        } else {
            try {
                await Mappings.create({
                    channel: command.channel_id,
                    emoji: parts[1].slice(1, -1),
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
    console.log('⚡️ Bolt app is running!');
})();