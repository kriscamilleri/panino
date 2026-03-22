export const BACKUP_STAGE_ORDER = ['queued', 'exporting_notes', 'building_tree', 'creating_commit', 'pushing_to_github'];

export const BACKUP_STAGE_LABELS = {
    queued: 'Queued',
    exporting_notes: 'Exporting notes and assets',
    building_tree: 'Building Git tree',
    creating_commit: 'Creating commit',
    pushing_to_github: 'Updating GitHub branch',
};

export function getBackupStageLabel(stage) {
    return BACKUP_STAGE_LABELS[stage] || 'Running backup';
}

export function buildBackupProgressSteps(currentStage) {
    const currentIndex = BACKUP_STAGE_ORDER.indexOf(currentStage);

    return [
        { key: 'exporting_notes', label: 'Export', index: 1 },
        { key: 'building_tree', label: 'Tree', index: 2 },
        { key: 'creating_commit', label: 'Commit', index: 3 },
        { key: 'pushing_to_github', label: 'Push', index: 4 },
    ].map((step) => {
        const isComplete = currentIndex > step.index;
        const isActive = currentIndex === step.index;

        return {
            ...step,
            stateClass: isComplete
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : isActive
                    ? 'border-blue-300 bg-blue-50 text-blue-800 shadow-sm'
                    : 'border-gray-200 bg-white text-gray-500',
        };
    });
}

export function resolveVisibleBackupStage({ status, retainedStage, isShowingCompletion }) {
    if (status?.isRunning) {
        return status.currentStage || retainedStage || 'queued';
    }

    if (isShowingCompletion) {
        return retainedStage || 'pushing_to_github';
    }

    return null;
}