import { describe, expect, it } from 'vitest';
import {
    buildBackupProgressSteps,
    getBackupStageLabel,
    resolveVisibleBackupStage,
} from '../../src/utils/githubBackupProgress.js';

describe('githubBackupProgress', () => {
    it('marks the active and completed progress steps for the current stage', () => {
        const steps = buildBackupProgressSteps('creating_commit');

        expect(steps.map((step) => step.stateClass)).toEqual([
            'border-gray-300 bg-gray-100 text-gray-700',
            'border-gray-300 bg-gray-100 text-gray-700',
            'border-gray-500 bg-white text-gray-900 shadow-sm',
            'border-gray-200 bg-white text-gray-500',
        ]);
    });

    it('resolves the running stage before falling back to retained progress', () => {
        expect(resolveVisibleBackupStage({
            status: { isRunning: true, currentStage: 'building_tree' },
            retainedStage: 'exporting_notes',
            isShowingCompletion: false,
        })).toBe('building_tree');
    });

    it('retains the last completed stage while the completion linger window is active', () => {
        expect(resolveVisibleBackupStage({
            status: { isRunning: false, currentStage: null },
            retainedStage: 'pushing_to_github',
            isShowingCompletion: true,
        })).toBe('pushing_to_github');
    });

    it('returns null when there is no visible progress to render', () => {
        expect(resolveVisibleBackupStage({
            status: { isRunning: false, currentStage: null },
            retainedStage: null,
            isShowingCompletion: false,
        })).toBeNull();
    });

    it('maps stage keys to user-facing labels', () => {
        expect(getBackupStageLabel('pushing_to_github')).toBe('Updating GitHub branch');
        expect(getBackupStageLabel('unknown_stage')).toBe('Running backup');
    });
});