'use strict';

const rewire = require('rewire');
const { DateTime, Duration } = require('luxon');

// Fish out private helper methods
const hLP = rewire('../handlers/handleListParticipants');
const handleListParticipants = hLP.handleListParticipants;
const sortJoinLeaveTimes = hLP.__get__('sortJoinLeaveTimes');
const activeBarWidth = hLP.__get__('activeBarWidth');
const timeToPercentage = hLP.__get__('timeToPercentage');

describe('listParticipants', () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      jest.clearAllMocks();
    });

    describe('sortJoinLeaveTimes', () => {
        it('single join works', async () => {
            expect.assertions(1);

            const result = await sortJoinLeaveTimes({
                JoinTimes: [1],
            });
            expect(result).toEqual([{time: 1, state: 1}]);
        });

        it('single leave works', async () => {
            expect.assertions(1);

            const result = await sortJoinLeaveTimes({
                LeaveTimes: [1],
            });
            expect(result).toEqual([{time: 1, state: 0}]);
        });

        it('simultaneous join leave works', async () => {
            expect.assertions(1);

            const result = await sortJoinLeaveTimes({
                JoinTimes: [1],
                LeaveTimes: [1],
            });
            expect(result).toEqual([{time: 1, state: 1}, {time: 1, state: 0}]);
        });

        it('join after leave works', async () => {
            expect.assertions(1);

            const result = await sortJoinLeaveTimes({
                JoinTimes: [1,3],
                LeaveTimes: [2,4],
            });
            expect(result).toEqual([{time: 1, state: 1}, {time: 2, state: 0}, { time: 3, state: 1 }, { time: 4, state: 0 }]);
        })
    });

    describe('activeBarWidth', () => {
        it('meeting ended', async () => {
            expect.assertions(1);

            const result = await activeBarWidth(DateTime.now().minus({hours: 2}),
                                                Duration.fromObject({hours: 1}),
                                                DateTime.now());
            expect(result).toBe(99);
        });

        it('95% duration exceeded', async () => {
            expect.assertions(1);

            const result = await activeBarWidth(DateTime.now().minus({hours: 2}),
                                                Duration.fromObject({hours: 1}),
                                                undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration not reached', async () => {
            expect.assertions(1);

            const result = await activeBarWidth(DateTime.now().minus({hours: 2}),
                                                Duration.fromObject({hours: 3}),
                                                undefined);
            expect(result).toBeCloseTo(100);
        });

        it('95% duration on the nose', async () => {
            expect.assertions(1);

            const result = await activeBarWidth(DateTime.now().minus({hours: 95}),
                                                Duration.fromObject({hours: 100}),
                                                undefined);
            expect(result).toBeCloseTo(95);
        });
    });

    describe('timeToPercentage', () => {
        it('meeting ended', async () => {
            expect.assertions(1);

            const result = await timeToPercentage(DateTime.now().minus({minutes: 30}),
                                                  DateTime.now().minus({hours: 1}),
                                                  Duration.fromObject({hours: 30}),
                                                  DateTime.now());
            expect(result).toBeCloseTo(1/2 * 99);
        });

        it('95% duration exceeded in regulation', async () => {
            expect.assertions(1);

            const result = await timeToPercentage(DateTime.now(),
                                                  DateTime.now().minus({hours: 1}),
                                                  Duration.fromObject({hours: 1}),
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration exceeded in overtime', async () => {
            expect.assertions(1);

            const result = await timeToPercentage(DateTime.now(),
                                                  DateTime.now().minus({hours: 1}),
                                                  Duration.fromObject({minutes: 30}),
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration not reached in regulation', async () => {
            expect.assertions(1);

            const result = await timeToPercentage(DateTime.now(),
                                                  DateTime.now().minus({hours: 1}),
                                                  Duration.fromObject({hours: 2}),
                                                  undefined);
            expect(result).toBeCloseTo(1/2 * 100);
        });

        it('95% duration not reached in overtime', async () => {
            expect.assertions(1);

            const result = await timeToPercentage(DateTime.now().minus({minutes: 30}),
                                                  DateTime.now().minus({hours: 1}),
                                                  Duration.fromObject({minutes: 30}),
                                                  undefined);
            expect(result).toBeCloseTo(1/2 * 95);
        });

        it('95% duration on the nose in regulation', async () => {
            expect.assertions(1);

            const result = await timeToPercentage(DateTime.now(),
                                                  DateTime.now().minus({hours: 95}),
                                                  Duration.fromObject({hours: 100}),
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration on the nose in overtime', async () => {
            expect.assertions(1);

            const result = await timeToPercentage(DateTime.now(),
                                                  DateTime.now().minus({hours: 96}),
                                                  Duration.fromObject({hours: 100}),
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });
    });
});
