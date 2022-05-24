Zoom Webinar Attendee List Tracker
==================================

This is a simple tool to work with [Zoom's webhook API](https://marketplace.zoom.us/docs/api-reference/webhook-reference/) to track attendees. In Zoom webinars, there is no way for a non-panelist participant to see who is present in the meeting, other than Panelists who have their video turned on. You cannot see other attendees, and you cannot even see panelists whose video is off. This tool attempts to provide a simple view of who is present in the meeting with you.

The app is implemented on top of two AWS services with generous free-tier availability, making it free to deploy in all but the most high-volume Zoom webinar environments. It's designed for use at the [Town of Portola Valley, CA](https://portolavalley.net/) for our community meetings, but should be easily adaptable for other users.

Other users will probably want to modify page titles in the web pages, and modify the custom domain referenced in serverless.yml; you will also need to put the webhook verification token that Zoom gives you when you register the webhook as a serverless environment variable called `ZOOM_AUTHORIZATION_CODE` - serverless will advise you of this if you try and deploy without setting it.

Once you have made those edits, you should be able to deploy with `serverless deploy`

Feedback
--------

If you have any feedback on this app, please submit it [here](https://github.com/Town-of-Portola-Valley/Zoom-Attendee-Webhook/issues/new).

Copyright & Usage
-----------------

This code is copyright by the [Authors](AUTHORS.md) under the [Apache License 2.0](LICENSE.md)
