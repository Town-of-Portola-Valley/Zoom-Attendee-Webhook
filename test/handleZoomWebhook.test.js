'use strict';

process.env.ZOOM_AUTHORIZATION_CODE = 'BOGUS_TOKEN';

const { dynamoDB, makeHTMLResponse, INTERNAL_SERVER_ERROR, AUTHORIZATION_CHECK } = require('../handlers/helpers');
const { _makeJoinOrLeaveObject: makeJoinOrLeaveObject,
    _updateJoinOrLeaveIfExists: updateJoinOrLeaveIfExists,
    _insertJoinOrLeaveIfNotExists: insertJoinOrLeaveIfNotExists,
     handleZoomWebhook } = require('../handlers/handleZoomWebhook');

describe('webhook', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    describe('makeJoinOrLeaveObject', () => {
        it('should work for join', async () => {
            expect.assertions(1);
            const result = await makeJoinOrLeaveObject(true, {
                object: {
                    id: '123',
                    topic: 'Meeting Title',
                    start_time: 'start',
                    duration: 60,
                    participant: {
                        participant_user_id: '12345',
                        user_id: '54321',
                        user_name: 'Joe Blow',
                        email: 'joe@example.com',
                        join_time: 'join',
                        leave_time: 'leave',
                    },
                },
            }, 987654);

            expect(result).toStrictEqual({
                webinar: {
                    MeetingID: '123',
                    MeetingTitle: 'Meeting Title',
                    MeetingStartTime: 'start',
                    MeetingDuration: 60,
                },
                participant: {
                    ParticipantID: '12345',
                    ParticipantSessionID: '54321',
                    ParticipantName: 'Joe Blow',
                    ParticipantEmail: 'joe@example.com',
                    JoinTime: 'join',
                },
                LastUpdatedAt: expect.any(String),
                EventTimestamp: 987654,
            });
        });

        it('should work for leave with phone number', async () => {
            expect.assertions(1);
            const result = await makeJoinOrLeaveObject(false, {
                object: {
                    id: '123',
                    topic: 'Meeting Title',
                    start_time: 'start',
                    duration: 60,
                    participant: {
                        user_id: '54321',
                        user_name: '16505551212',
                        join_time: 'join',
                        leave_time: 'leave',
                    },
                },
            }, 987654);

            expect(result).toStrictEqual({
                webinar: {
                    MeetingID: '123',
                    MeetingTitle: 'Meeting Title',
                    MeetingStartTime: 'start',
                    MeetingDuration: 60,
                },
                participant: {
                    ParticipantID: '16505551212',
                    ParticipantSessionID: '54321',
                    ParticipantName: '16505551212',
                    ParticipantEmail: undefined,
                    LeaveTime: 'leave',
                },
                LastUpdatedAt: expect.any(String),
                EventTimestamp: 987654,
            });
        });
    });

    describe('updateJoinOrLeaveIfExists', () => {
        it('should work for join', async () => {
            expect.assertions(5);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                    }),
                });

            await updateJoinOrLeaveIfExists(true, {
                webinar: {
                    MeetingID: '123',
                    MeetingTitle: 'Meeting Title',
                    MeetingStartTime: 'start',
                    MeetingDuration: 60,
                },
                participant: {
                    ParticipantID: '12345',
                    ParticipantSessionID: '54321',
                    ParticipantName: 'Joe Blow',
                    ParticipantEmail: 'joe@example.com',
                    JoinTime: 'join',
                    LeaveTime: 'leave',
                },
                LastUpdatedAt: 'update',
                EventTimestamp: 987654,
            });

            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith({
                Statement: expect.stringContaining('IDs, <<54321>>'),
                Parameters: [
                    { S: 'Meeting Title' },
                    { N: '60' },
                    { S: 'Joe Blow' },
                    { S: 'joe@example.com' },
                    { S: expect.any(String) },
                    { N: '123' },
                    { S: '12345' },
                    { N: '987654' },
                ],
            });
            expect(dynamoDB.executeStatement.mock.lastCall[0].Statement).toStrictEqual(expect.stringContaining("SET JoinTimes=set_add(JoinTimes, <<'join'>>"));
            expect(dynamoDB.executeStatement.mock.lastCall[0].Statement).toStrictEqual(expect.stringContaining('SET ParticipationCount=ParticipationCount + 1'));
            expect(dynamoDB.executeStatement.mock.lastCall[0].Statement).toStrictEqual(expect.stringContaining('SET EventTimestamps=set_add(EventTimestamps, <<987654>>'));
        });

        it('should work for leave', async () => {
            expect.assertions(3);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                    }),
                });

            await updateJoinOrLeaveIfExists(false, {
                webinar: {
                    MeetingID: '123',
                    MeetingTitle: 'Meeting Title',
                    MeetingStartTime: 'start',
                    MeetingDuration: 60,
                },
                participant: {
                    ParticipantID: '12345',
                    ParticipantSessionID: '54321',
                    ParticipantName: 'Joe Blow',
                    ParticipantEmail: 'joe@example.com',
                    JoinTime: 'join',
                    LeaveTime: 'leave',
                },
                LastUpdatedAt: 'update',
                EventTimestamp: 987654,
            });

            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            expect(dynamoDB.executeStatement.mock.lastCall[0].Statement).toStrictEqual(expect.stringContaining("SET LeaveTimes=set_add(LeaveTimes, <<'leave'>>"));
            expect(dynamoDB.executeStatement.mock.lastCall[0].Statement).toStrictEqual(expect.stringContaining('SET ParticipationCount=ParticipationCount - 1'));
        });
    });

    describe('insertJoinOrLeaveIfNotExists', () => {
        it('should work for join', async () => {
            expect.assertions(2);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                    }),
                });

            await insertJoinOrLeaveIfNotExists(true, {
                webinar: {
                    MeetingID: '123',
                    MeetingTitle: 'Meeting Title',
                    MeetingStartTime: 'start',
                    MeetingDuration: 60,
                },
                participant: {
                    ParticipantID: '12345',
                    ParticipantSessionID: '54321',
                    ParticipantName: 'Joe Blow',
                    ParticipantEmail: 'joe@example.com',
                    JoinTime: 'join',
                    LeaveTime: 'leave',
                },
                LastUpdatedAt: 'update',
                EventTimestamp: 987654,
            });

            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith({
                Statement: expect.stringContaining('JoinTimes'),
                Parameters: [
                    { N: '123' },
                    { S: '12345' },
                    { S: 'Meeting Title' },
                    { S: 'start' },
                    { N: '60' },
                    { NS: ['54321'] },
                    { S: 'Joe Blow' },
                    { S: 'joe@example.com' },
                    { SS: ['join'] },
                    { N: '1' },
                    { S: expect.any(String) },
                    { NS: ['987654'] },
                ],
            });
        });

        it('should work for leave', async () => {
            expect.assertions(2);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                    }),
                });

            await insertJoinOrLeaveIfNotExists(false, {
                webinar: {
                    MeetingID: '123',
                    MeetingTitle: 'Meeting Title',
                    MeetingStartTime: 'start',
                    MeetingDuration: 60,
                },
                participant: {
                    ParticipantID: '12345',
                    ParticipantSessionID: '54321',
                    ParticipantName: 'Joe Blow',
                    ParticipantEmail: 'joe@example.com',
                    JoinTime: 'join',
                    LeaveTime: 'leave',
                },
                LastUpdatedAt: 'update',
                EventTimestamp: 987654,
            });

            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith({
                Statement: expect.stringContaining('LeaveTimes'),
                Parameters: [
                    { N: '123' },
                    { S: '12345' },
                    { S: 'Meeting Title' },
                    { S: 'start' },
                    { N: '60' },
                    { NS: ['54321'] },
                    { S: 'Joe Blow' },
                    { S: 'joe@example.com' },
                    { SS: ['leave'] },
                    { N: '0' },
                    { S: expect.any(String) },
                    { NS: ['987654'] },
                ],
            });
        });
    });

    describe('basic data checks', () => {
        it('should detect missing events', async () => {
            expect.assertions(1);

            const result = await handleZoomWebhook();
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            expect(result).toStrictEqual(expected);
        });

        it('should respond correctly to keep-alive pings', async () => {
            expect.assertions(3);

            const event = require('./fixtures/keep-alive.json');
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect(result.statusCode).toBeGreaterThanOrEqual(200);
            expect(result.statusCode).toBeLessThan(300);
        });

        it('should respond correctly when passed no headers', async () => {
            expect.assertions(1);

            const event = {};
            const result = await handleZoomWebhook(event);
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            expect(result).toStrictEqual(expected);
        });

        it('should fail if bad auth code', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: 'BAD_CODE' } };
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect(result.statusCode).toBe(401);
        });

        it('should fail if good auth code but no body', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK } };
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect(result.statusCode).toBe(400);
        });

        it('should fail if good auth code but body is bad JSON', async () => {
            expect.assertions(1);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: '{' };
            const result = handleZoomWebhook(event);

            await expect(result).rejects.toThrow('Unexpected end of JSON input');
        });

        it('should fail if body has no event', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: '{ "payload": 123 }' };
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
                body: expect.stringContaining('The body must contain a payload and an event'),
                isBase64Encoded: false,
            });
            expect(result.statusCode).toBe(422);
        });

        it('should fail if body has no payload', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: '{ "event": 123 }' };
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
                body: expect.stringContaining('The body must contain a payload and an event'),
                isBase64Encoded: false,
            });
            expect(result.statusCode).toBe(422);
        });

        it('should fail if event is wrong', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: JSON.stringify({
                event: 'webinar.random_event',
                payload: {},
            }) };
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
                body: expect.stringContaining('Unexpected event type: webinar.random_event'),
                isBase64Encoded: false,
            });
            expect(result.statusCode).toBe(422);
        });
    });

    describe('join', () => {
        it('should succeed when first person joins', async () => {
            expect.assertions(6);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.reject('Does not exist') }) // Update fails
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Insert succeeds though') }); // Insert succeeds

            const event = require('./fixtures/participant-joined.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(2);
            // We should have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should NOT have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should be inserting with ParticipantCount = 1
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.arrayContaining([{ N: '1' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
            // We should NOT be inserting with ParticipantCount = 0
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.not.arrayContaining([{ N: '0' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('should succeed when person joins who is already known', async () => {
            expect.assertions(5);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Already exists') }) // Update succeeds
                .mockReturnValueOnce({ promise: async () => Promise.reject('Insert would fail') }); // Insert would fail cos exists

            const event = require('./fixtures/participant-joined.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            // We should have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should NOT have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should NOT be inserting
            expect(dynamoDB.executeStatement).not.toHaveBeenLastCalledWith(expect.objectContaining({
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('should succeed when first person joins with no participant_user_id', async () => {
            expect.assertions(6);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.reject('Does not exist') }) // Update fails
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Insert succeeds though') }); // Insert succeeds

            const event = require('./fixtures/participant-joined-no-participant_user_id.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(2);
            // We should have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should NOT have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should be inserting with ParticipantCount = 1
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.arrayContaining([{ N: '1' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
            // We should NOT be inserting with ParticipantCount = 0
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.not.arrayContaining([{ N: '0' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('should succeed when person joins who is already known with no participant_user_id', async () => {
            expect.assertions(5);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Already exists') }) // Update succeeds
                .mockReturnValueOnce({ promise: async () => Promise.reject('Insert would fail') }); // Insert would fail cos exists

            const event = require('./fixtures/participant-joined-no-participant_user_id.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            // We should have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should NOT have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should NOT be inserting
            expect(dynamoDB.executeStatement).not.toHaveBeenLastCalledWith(expect.objectContaining({
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('duplicate event should do nothing', async () => {
            expect.assertions(2);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.reject('Already exists') }) // Update fails cos event_timestamp
                .mockReturnValueOnce({ promise: async () => Promise.reject('Insert fails') }); // Insert fails also cos unique key

            const event = require('./fixtures/participant-joined.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(2);
        });
    });

    describe('leave', () => {
        it('should succeed when unknown person leaves', async () => {
            expect.assertions(6);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.reject('Does not exist') }) // Update fails
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Insert succeeds though') }); // Insert succeeds

            const event = require('./fixtures/participant-left.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(2);
            // We should have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should NOT have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should be inserting with ParticipantCount = 0
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.arrayContaining([{ N: '0' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
            // We should NOT be inserting with ParticipantCount = 1
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.not.arrayContaining([{ N: '1' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('should succeed when person leaves who is already known', async () => {
            expect.assertions(5);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Already exists') }) // Update succeeds
                .mockReturnValueOnce({ promise: async () => Promise.reject('Insert would fail') }); // Insert would fail cos exists

            const event = require('./fixtures/participant-left.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            // We should have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should NOT have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should NOT be inserting
            expect(dynamoDB.executeStatement).not.toHaveBeenLastCalledWith(expect.objectContaining({
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('should succeed when unknown person leaves with no participant_user_id', async () => {
            expect.assertions(6);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.reject('Does not exist') }) // Update fails
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Insert succeeds though') }); // Insert succeeds

            const event = require('./fixtures/participant-left-no-participant_user_id.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(2);
            // We should have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should NOT have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should be inserting with ParticipantCount = 0
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.arrayContaining([{ N: '0' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
            // We should NOT be inserting with ParticipantCount = 1
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.not.arrayContaining([{ N: '1' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('should succeed when person leaves who is already known with no participant_user_id', async () => {
            expect.assertions(5);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Already exists') }) // Update succeeds
                .mockReturnValueOnce({ promise: async () => Promise.reject('Insert would fail') }); // Insert would fail cos exists

            const event = require('./fixtures/participant-left-no-participant_user_id.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            // We should have attempted to decrement ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should NOT have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should NOT be inserting
            expect(dynamoDB.executeStatement).not.toHaveBeenLastCalledWith(expect.objectContaining({
                Statement: expect.stringContaining('INSERT'),
            }));
        });

        it('duplicate event should do nothing', async () => {
            expect.assertions(2);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.reject('Already exists') }) // Update fails cos event_timestamp
                .mockReturnValueOnce({ promise: async () => Promise.reject('Insert fails') }); // Insert fails also cos unique key

            const event = require('./fixtures/participant-left.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = await handleZoomWebhook(event);

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(2);
        });
    });
});
