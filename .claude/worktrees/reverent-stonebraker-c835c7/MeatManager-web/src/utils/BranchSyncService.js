class BranchSyncService {
    constructor() {
        this.directoryHandle = null;
        this.detectedFiles = [];
        this.onFilesDetected = null;
    }

    async setDirectory(handle) {
        this.directoryHandle = handle;
        // Verify permission
        const options = { mode: 'read' };
        if (await handle.queryPermission(options) !== 'granted') {
            await handle.requestPermission(options);
        }
        this.startPolling();
    }

    async checkFiles() {
        if (!this.directoryHandle) return;

        try {
            const files = [];
            const personalKey = `FROM_${(localStorage.getItem('branch_name') || 'Casa_Central').replace(/\s/g, '_')}`;

            for await (const entry of this.directoryHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.meat')) {
                    if (!entry.name.startsWith(personalKey)) {
                        files.push(entry.name);
                    }
                }
            }

            this.detectedFiles = files;
            if (this.onFilesDetected) {
                this.onFilesDetected(files);
            }

            // Sync with localStorage for Sidebar badge
            localStorage.setItem('branch_notif_count', files.length.toString());
        } catch (err) {
            console.error('Error polling branch directory:', err);
        }
    }

    startPolling() {
        if (this.interval) clearInterval(this.interval);
        this.checkFiles();
        this.interval = setInterval(() => this.checkFiles(), 15000); // 15 seconds
    }

    stopPolling() {
        if (this.interval) clearInterval(this.interval);
    }
}

export const branchSyncService = new BranchSyncService();
