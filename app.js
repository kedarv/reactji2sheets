import envSchema from "env-schema";
import pkg from '@slack/bolt';
const { App } = pkg;

const schema = {
    type: 'object',
    required: ['SLACK_SIGNING_SECRET', 'SLACK_BOT_TOKEN'],
    properties: {
        SLACK_SIGNING_SECRET: {
            type: 'string',
        },
        SLACK_BOT_TOKEN: {
            type: 'string',
        },
        SLACK_APP_TOKEN: {
            type: 'string',
        }
    }
}
const config = envSchema({
    schema: schema,
    data: process.env,
    dotenv: true,
})

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
});

app.event('reaction_added', async ({ event, client, say }) => {
    console.log(event.item.channel)
    try {
      const result = await client.conversations.history({
        channel: event.item.channel,
        latest: event.item.ts,
        inclusive: true,
        limit: 1
      });
  
      const message = result.messages[0];
  
      console.log('message:', message);
      await say({text:`got it!`,thread_ts:event.item.ts});
    }
    catch(e) {
      console.log('error:', e);
    }
  });

(async () => {
    // Start your app
    await app.start(process.env.PORT || 3000);

    console.log('⚡️ Bolt app is running!');
})();