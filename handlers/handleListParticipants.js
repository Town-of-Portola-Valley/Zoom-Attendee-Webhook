'use strict';

const logger = require('@hughescr/logger').logger;
const _ = require('lodash');
const pug = require('pug');

const {
        makeHTMLResponse,
        makeEmptyResponse,
        dynamoDB,
        NO_EVENT_RECEIVED,
        INTERNAL_SERVER_ERROR,
        KEEP_ALIVE,
        ACCEPT_ENCODING,
        DB_TABLE,
        DATETIME_CLEAR,
        TIME_SIMPLENOZERO,
        TIME_SIMPLENOZERO_NOTZ,
        TIMEZONE,
        git_version,
      } = require('./helpers.js');

const { DateTime, Duration } = require('luxon');
DateTime.DATETIME_CLEAR = DATETIME_CLEAR;
DateTime.TIME_SIMPLENOZERO = TIME_SIMPLENOZERO;

const AWS = require('aws-sdk');

const listParticipantsTemplate = pug.compileFile('views/list-participants.pug');

// Sort the `participant.JoinTimes` and `participant.LeaveTimes` chronologically into a single array of objects with
// `[{time:..., state:...}]` where state is incremented if the time at that position is a Join and decremented for a Leave
const sortJoinLeaveTimes = (participant, meetingStartTime) => {
    const joinMerge = _.map(participant.JoinTimes, t => ({ time: t, join: true }));
    const leaveMerge = _.map(participant.LeaveTimes, t => ({ time: t, join: false }));
    const mergedSort = _.sortBy([...joinMerge, ...leaveMerge], 'time'); // In a tie, join before leave thanks to stable sort
    return _.reduce(mergedSort, (result, value, key) => {
        const newItem = { time: value.time };
        if(value.join) {
            newItem.state = result[key].state + 1;
        } else {
            newItem.state = _.max([result[key].state - 1, 0]); // Cannot go below 0
        }
        return [...result, newItem];
    }, [{ time : meetingStartTime, state: 0 }]);
};
module.exports._sortJoinLeaveTimes = sortJoinLeaveTimes;

// How wide (as a percentage) should the active part of the bar be, reserving the remainder for the "tail"
const activeBarWidth = (meetingStartTime, scheduledDuration, meetingEndTime) => {
    if(meetingEndTime) {
        return 99;
    }
    const timeSinceStart = DateTime.now().diff(meetingStartTime);
    if(timeSinceStart / scheduledDuration < 0.95) {
        return 100;
    } else {
        return 95;
    }
};
module.exports._activeBarWidth = activeBarWidth;

const durationToPercentage = (duration, meetingStartTime, scheduledDuration, meetingEndTime) => {
    const activeWidth = activeBarWidth(meetingStartTime, scheduledDuration, meetingEndTime);
    if(meetingEndTime) {
        return activeWidth * (duration / meetingEndTime.diff(meetingStartTime));
    }
    const nowSinceStart = DateTime.now().diff(meetingStartTime);
    if(nowSinceStart / scheduledDuration < 0.95) {
        return activeWidth * duration / scheduledDuration;
    } else {
        return activeWidth * duration / nowSinceStart;
    }
};
module.exports._durationToPercentage = durationToPercentage;

// For a participant, chunk up an array of percentage values and present/absent values for building
// the bootstrap progress bar
// eg. [{percent: 0, present: true}, {percent: 40, present: false}]
// which shows someone who joined at meeting start and left 40% through
const participantProgressData = async (participant, meetingStartTime, scheduledDuration, meetingEndTime) => {
    const sortedTimes = sortJoinLeaveTimes(participant, meetingStartTime);
    const now = DateTime.now();
    return Promise.all(_.map(sortedTimes, async (t, i) => {
        let endTime;
        if(sortedTimes[i + 1]) {
            endTime = sortedTimes[i + 1].time;
        } else if(meetingEndTime) {
            endTime = meetingEndTime;
        } else {
            endTime = now;
        }
        const result = {
            percent: durationToPercentage(endTime.diff(t.time), meetingStartTime, scheduledDuration, meetingEndTime),
            present: t.state > 0,
        };
        if(result.present) { // Add a tooltip
            const nextTime = sortedTimes[i + 1];
            if(nextTime) {
                result.tooltip = `${t.time.setZone(TIMEZONE).toLocaleString(TIME_SIMPLENOZERO_NOTZ)} - ${nextTime.time.setZone(TIMEZONE).toLocaleString(TIME_SIMPLENOZERO)}`;
            } else {
                result.tooltip = `Entered: ${t.time.setZone(TIMEZONE).toLocaleString(TIME_SIMPLENOZERO)}`;
            }
        }
        return result;
    }));
};
module.exports._participantProgressData = participantProgressData;

const fetchDataFromDynamo = async (meetingID) => {
    // Stryker disable StringLiteral: This query is correct but won't be tested due to mocking
    const statement = `SELECT MeetingID,
                              MeetingTitle,
                              MeetingStartTime,
                              MeetingDuration,
                              ParticipantName,
                              ParticipantEmail,
                              ParticipationCount,
                              JoinTimes,
                              LeaveTimes
                        FROM ${DB_TABLE}."MeetingID-ParticipationCount"
                        WHERE MeetingID = ${meetingID}`;
    // Stryker enable StringLiteral

    let nextToken = undefined;
    let items = [];
    do {
        const raw = await dynamoDB.executeStatement({ Statement: statement, nextToken }).promise();
        items = [...items, ...raw.Items];
        nextToken = raw.nextToken;
    } while(nextToken);

    return items;
};
module.exports._fetchDataFromDynamo = fetchDataFromDynamo;

const preProcessResults = (meetingID, items) => {
    return (items.length === 0) ? {
        MeetingTitle: 'This meeting does not exist',
        MeetingID: meetingID,
        MeetingStartTime: DateTime.now(),
        MeetingDuration: Duration.fromObject({}), // 0 duration
        ParticipantCount: 0,
        results: {},
    } : {
        MeetingTitle: items[0].MeetingTitle.S,
        MeetingID: items[0].MeetingID.N,
        MeetingStartTime: DateTime.fromISO(_(items).sortBy('MeetingStartTime.S').head().MeetingStartTime.S),
        MeetingDuration: Duration.fromObject({ minutes: items[0].MeetingDuration.N }),
        ParticipantCount: items.length,
        results: _(items)
            .map(AWS.DynamoDB.Converter.unmarshall)
            .map(i => ({
                ...i,
                JoinTimes: _.map(i.JoinTimes && i.JoinTimes.values || [], DateTime.fromISO),
                LeaveTimes: _.map(i.LeaveTimes && i.LeaveTimes.values || [], DateTime.fromISO),
                JoinTime: i.ParticipationCount ? _(i.JoinTimes.values).sortBy().map(DateTime.fromISO).last() : DateTime.now(), // Find the latest join time
                LeaveTime: i.ParticipationCount ? DateTime.now() : _(i.LeaveTimes.values).sortBy().map(DateTime.fromISO).last(),
                ParticipantOnline: i.ParticipationCount ? 'online' : 'offline',
            }))
            .map(i => _.omit(i, ['MeetingTitle', 'MeetingID', 'ParticipationCount', 'MeetingStartTime', 'MeetingDuration']))
            .groupBy('ParticipantOnline')
            .value(),
    };
};
module.exports._preProcessResults = preProcessResults;

module.exports.handleListParticipants = async (event) => {
    if(!event) {
        logger.error(NO_EVENT_RECEIVED);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    if(event[KEEP_ALIVE]) {
        return makeEmptyResponse(204);
    }

    if(!event.headers) {
        logger.error('No headers were in the event', event);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    const acceptEncoding = event.headers && event.headers[ACCEPT_ENCODING];
    const meetingID = event.pathParameters && event.pathParameters.meeting_id;

    if(!meetingID) {
        logger.error('The meeting ID is missing from the path somehow', event);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    const items = await fetchDataFromDynamo(meetingID);

    const { MeetingTitle, MeetingID, MeetingStartTime, MeetingDuration, ParticipantCount, results } = preProcessResults(meetingID, items);

    const sortedOnline = _(results.online).sortBy('JoinTime').reverse().value();
    const sortedOffline = _(results.offline).sortBy('LeaveTime').reverse().value();

    const MeetingEndTime = sortedOnline.length ? undefined : _.head(sortedOffline) && _.head(sortedOffline).LeaveTime || DateTime.now();

    const onlineParticipants = await Promise.all(_.map(sortedOnline, async (p) => {
        p.progressData = await participantProgressData(p, MeetingStartTime, MeetingDuration, MeetingEndTime);
        return p;
    }));
    const offlineParticipants = await Promise.all(_.map(sortedOffline, async (p) => {
        p.progressData = await participantProgressData(p, MeetingStartTime, MeetingDuration, MeetingEndTime);
        return p;
    }));

    const response = listParticipantsTemplate({
        DateTime,
        TIMEZONE,
        page: { version: (await git_version)[1].gitVersion },
        meeting: {
            MeetingTitle,
            MeetingID,
            MeetingStartTime,
            MeetingDuration,
            MeetingEndTime,
            ParticipantCount,
            CurrentCount: onlineParticipants.length,
        },
        participants: items.length ? [
            {
                title: 'Online',
                participants: onlineParticipants,
            },
            {
                title: 'Left the meeting',
                participants: offlineParticipants,
            }
        ] : [
            {
                title: 'There is no record of any participant',
                participants: [],
            }
        ],
    });

    return makeHTMLResponse(200, response, acceptEncoding);
};
