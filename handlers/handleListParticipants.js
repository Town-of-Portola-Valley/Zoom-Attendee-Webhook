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
        git_version,
      } = require('./helpers.js');

const { DateTime, Duration } = require('luxon');
DateTime.DATETIME_CLEAR = DATETIME_CLEAR;

const AWS = require('aws-sdk');

const listParticipantsTemplate = pug.compileFile('views/list-participants.pug');

// Sort the `participant.JoinTimes` and `participant.LeaveTimes` chronologically into a single array of objects with
// `[{time:..., state:...}]` where state is incremented if the time at that position is a Join and decremented for a Leave
const sortJoinLeaveTimes = async (participant) => {
    const joinMerge = _.map(participant.JoinTimes, t => ({time: t, join: true}));
    const leaveMerge = _.map(participant.LeaveTimes, t => ({time: t, join: false}));
    const mergedSort = _.sortBy([...joinMerge, ...leaveMerge], 'time'); // In a tie, join before leave thanks to stable sort
    const result = _.reduce(mergedSort, (result, value, key) => {
        const newItem = { time: value.time };
        if(value.join) {
            newItem.state = result[key].state + 1;
        } else {
            newItem.state = _.max([result[key].state - 1, 0]); // Cannot go below 0
        }
        return [...result, newItem];
    }, [{time : 0, state: 0}]);
    result.shift();
    return result;
};

// How wide (as a percentage) should the active part of the bar be, reserving the remainder for the "tail"
const activeBarWidth = async (meetingStartTime, scheduledDuration, meetingEndTime) => {
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

const timeToPercentage = async (time, meetingStartTime, scheduledDuration, meetingEndTime) => {
    const activeWidth = await activeBarWidth(meetingStartTime, scheduledDuration, meetingEndTime);
    const timeSinceStart = time.diff(meetingStartTime);
    if(meetingEndTime) {
        return activeWidth * (timeSinceStart/meetingEndTime.diff(meetingStartTime));
    }
    const nowSinceStart = DateTime.now().diff(meetingStartTime);
    if(nowSinceStart / scheduledDuration < 0.95) {
        return activeWidth * timeSinceStart / scheduledDuration;
    } else {
        return activeWidth * timeSinceStart / nowSinceStart;
    }
};

// For a participant, chunk up an array of percentage values and present/absent values for building
// the bootstrap progress bar
// eg. [{percent: 0, present: true}, {percent: 40, present: false}]
// which shows someone who joined at meeting start and left 40% through
const participantProgressData = async (participant, meetingStartTime, scheduledDuration, meetingEndTime) => {
    const sortedTimes = sortJoinLeaveTimes(participant);
    return _.map(sortedTimed, t => ({
        percent: timeToPercentage(t.time, meetingStartTime, scheduledDuration, meetingEndTime),
        present: t.state > 0,
    }))
};

module.exports.handleListParticipants = async (event) => {
    if(!event) {
        logger.error(NO_EVENT_RECEIVED);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    if(event[KEEP_ALIVE]) {
        return makeEmptyResponse(204);
    }

    const acceptEncoding = event.headers && event.headers[ACCEPT_ENCODING];
    const meetingID = event.pathParameters.meeting_id;

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

    let nextToken = undefined;
    let items = [];
    do {
        const raw = await dynamoDB.executeStatement({ Statement: statement, nextToken }).promise();
        logger.info('RAW', raw);
        items = [...items, ...raw.Items];
        nextToken = raw.nextToken;
    } while(nextToken);

    const { MeetingTitle, MeetingID, MeetingStartTime, MeetingDuration, ParticipantCount, results } =
        (items.length === 0) ? {
            MeetingTitle : 'This meeting does not exist',
            MeetingID : event.pathParameters.meeting_id,
            MeetingStartTime : DateTime.now(),
            MeetingDuration : Duration.fromObject({ minutes: 0 }),
            ParticipantCount : 0,
            results: {},
        } : {
            MeetingTitle : items[0].MeetingTitle.S,
            MeetingID : items[0].MeetingID.N,
            MeetingStartTime : DateTime.fromISO(items[0].MeetingStartTime.S),
            MeetingDuration : Duration.fromObject({ minutes: items[0].MeetingDuration.N }),
            ParticipantCount : items.length,
            results: _(items)
                    .map(AWS.DynamoDB.Converter.unmarshall)
                    .map(i => ({
                            ...i,
                            MeetingStartTime: DateTime.fromISO(i.MeetingStartTime),
                            MeetingDuration: Duration.fromObject({ minutes: i.MeetingDuration }),
                            JoinTime: i.ParticipationCount ? _(i.JoinTimes.values).sortBy().map(DateTime.fromISO).last() : DateTime.now(), // Find the latest join time
                            LeaveTime: i.ParticipationCount ? DateTime.now() : _(i.LeaveTimes.values).sortBy().map(DateTime.fromISO).last(),
                            ParticipationCount: i.ParticipationCount ? 1 : 0,
                    }))
                    .groupBy('ParticipationCount')
                    .value(),
        };

    logger.info({ results: results });

    const MeetingEndTime = ParticipantCount ? undefined : _(results['0']).sortBy('LeaveTime').reverse().first().LeaveTime;
    const onlineParticipants = _(results['1']).sortBy('JoinTime').reverse().map(p => {
        p.progressData = participantProgressData(p);
        return p;
    }).value();
    const offlineParticipants = _(results['0']).sortBy('JoinTime').reverse().map(p => {
        p.progressData = participantProgressData(p);
        return p;
    }).value();

    const response = listParticipantsTemplate({
        DateTime,
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
