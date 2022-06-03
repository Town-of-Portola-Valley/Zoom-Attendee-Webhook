'use strict';

const { handleZoomWebhook } = require('./handlers/handleZoomWebhook.js');
const { handleListMeetings } = require('./handlers/handleListMeetings.js');
const { handleListParticipants } = require('./handlers/handleListParticipants.js');

module.exports = {
    handleZoomWebhook,
    handleListMeetings,
    handleListParticipants,
};
