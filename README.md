# reactji2sheets

allows users to move Slack messages into Google sheets with a reaction emoji.

### user setup
First, install the Production Bot to your Slack Workspace

<a href="https://slack.com/oauth/v2/authorize?client_id=194150241269.4604262349524&scope=channels:history,chat:write,commands,groups:history,reactions:read,reactions:write,users:read&user_scope="><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcSet="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>

Then, issue the command

`/reactji2sheets register :your_emoji: your_google_sheets_id`

If this is the first time you have done this, you will need to authenticate with Google to grant reactji2sheets to write to Google Sheets. Then, you would need to invoke the same command again to setup the emoji.

Finally, react with your picked emoji on any message and it will show up in Google Sheets!

### developer setup
this bot uses [fastify](https://www.fastify.io/) and sqlite, running on [fly.io](https://fly.io/) in [production](https://reactji2sheets.fly.dev/). you can run it anywhere Node can run with a persistent data volume.

to run, create a .env file and obtain the following credentials:

From Slack:
- `SLACK_SIGNING_SECRET`
- `SLACK_APP_TOKEN`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`

From Google (GCP):
- `GOOGLE_APIS_CLIENT_ID`
- `GOOGLE_APIS_CLIENT_SECRET`
- `GOOGLE_APIS_REDIRECT_URL`
