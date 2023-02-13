'use strict';

const { handleZoomWebhook } = require('./handlers/handleZoomWebhook.js');
const { handleListMeetings } = require('./handlers/handleListMeetings.js');
const { handleListParticipants } = require('./handlers/handleListParticipants.js');
const { handleSitemap } = require('./handlers/handleSitemap.js');

module.exports = {
    handleZoomWebhook,
    handleListMeetings,
    handleListParticipants,
    handleSitemap,
};
