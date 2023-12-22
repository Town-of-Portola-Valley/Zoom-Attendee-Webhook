Zoom Webinar Attendee List Tracker
==================================

[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FTown-of-Portola-Valley%2FZoom-Attendee-Webhook%2Fdevelop)](https://dashboard.stryker-mutator.io/reports/github.com/Town-of-Portola-Valley/Zoom-Attendee-Webhook/develop)

This is a simple tool to work with [Zoom's webhook API](https://marketplace.zoom.us/docs/api-reference/webhook-reference/) to track attendees. In Zoom webinars, there is no way for a non-panelist participant to see who is present in the meeting, other than Panelists who have their video turned on. You cannot see other attendees, and you cannot even see panelists whose video is off. This tool attempts to provide a simple view of who is present in the meeting with you.

The app is implemented on top of two AWS services with generous free-tier availability, making it free to deploy in all but the most high-volume Zoom webinar environments. It's designed for use at the [Town of Portola Valley, CA](https://portolavalley.net/) for our community meetings, but should be easily adaptable for other users.

Before deploying, you need to set the following serverless params:

 - `ORGANIZATION_NAME` - the name of the organization deploying the project. This will be used in page titles and such. eg *Town of Portola Valley*
 - `DOMAIN_NAME` - the name of a hostname in a domain served by the AWS account via route53 which will be used as the endpoint for the service. eg *pv-zooms.rungie.com*
 - `SHORT_PREFIX` - a two-letter prefix that will uniquely identify this deployment within your AWS account. You can deploy multiple organizations within the same AWS account by having a unique `SHORT_PREFIX` for each. eg *PV*
 - `ZOOM_WEBHOOK_SECRET_TOKEN` - the secret token generated by Zoom when you set up the webhook in the admin console. eg *Zg4FxipeHQFeEsBqYItwff*

Once you have made those edits, you should be able to deploy with `serverless deploy`

Feedback
--------

If you have any feedback on this app, please submit it [here](https://github.com/Town-of-Portola-Valley/Zoom-Attendee-Webhook/issues/new).

Copyright & Usage
-----------------

This code is copyright by the [Authors](AUTHORS.md) under the [Apache License 2.0](LICENSE.md)
