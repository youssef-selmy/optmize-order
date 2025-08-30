// 030-background-job-scheduler.js (Original: BackgroundJobScheduler.js)
const { _admin, _firestore, _functions } = require('./001-setup-initialization'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path

// Import classes used in scheduled jobs (ensure these are imported before initializing jobs)
const AutoCleanupService = require('./029-auto-cleanup-service'); // Updated path
const PerformanceMonitor = require('./027-performance-monitor'); // Updated path
const AdvancedCacheManager = require('./026-advanced-cache-manager'); // For memory cleanup (Updated path)
const EnhancedSecurityMonitoring = require('./025-enhanced-security-monitoring'); // Updated path
const SmartResourceManager = require('./024-smart-resource-management'); // For memory thresholds (Updated path)
const OptimizedDriverSearch = require('./023-optimized-driver-search'); // For in-memory cleanup (Updated path)
const PredictiveAnalytics = require('./020-predictive-analytics'); // Updated path

class BackgroundJobScheduler {
    static jobs = new Map();
    static jobQueue = []; // Conceptual, jobs picked directly from map
    static isProcessing = false;
    static maxConcurrentJobs = 5;
    static currentlyRunning = new Set();
    static schedulerIntervalId = null;

    static scheduleJob(jobId, jobFunction, schedule, options = {}) {
        const job = {
            id: jobId,
            function: jobFunction,
            schedule,
            options: {
                priority: options.priority || 'normal',
                maxRetries: options.maxRetries || 3,
                timeout: options.timeout || 300000,
                ...options
            },
            nextRun: this.calculateNextRun(schedule),
            lastRun: null,
            retryCount: 0,
            status: 'scheduled', // 'scheduled', 'running', 'completed', 'failed', 'timeout'
            startedAt: null,
            executionTime: null,
            lastError: null
        };

        this.jobs.set(jobId, job);
        console.log(`JOB_SCHEDULER: Scheduled job: ${jobId}. Next run: ${new Date(job.nextRun).toLocaleString()}`);
    }

    static calculateNextRun(schedule) {
        const now = Date.now();

        if (typeof schedule === 'number') {
            return schedule > now ? schedule : now;
        }

        if (typeof schedule === 'string' && schedule.startsWith('every ')) {
            const interval = this.parseInterval(schedule);
            return now + interval;
        }

        return now + 60000; // Default to 1 minute
    }

    static parseInterval(scheduleString) {
        const intervals = {
            'every second': 1000,
            'every 5 seconds': 5 * 1000,
            'every 10 seconds': 10 * 1000,
            'every 30 seconds': 30 * 1000,
            'every minute': 60 * 1000,
            'every 5 minutes': 5 * 60 * 1000,
            'every 10 minutes': 10 * 60 * 1000,
            'every 30 minutes': 30 * 60 * 1000,
            'every hour': 60 * 60 * 1000,
            'every day': 24 * 60 * 60 * 1000
        };

        return intervals[scheduleString] || 60 * 1000;
    }

    static startScheduler(intervalMs = 1000) { // Checks for jobs every 1 second
        if (this.schedulerIntervalId) {
            console.warn('JOB_SCHEDULER: Scheduler already running.');
            return;
        }
        this.schedulerIntervalId = setInterval(() => this.processJobQueue(), intervalMs);
        console.log(`JOB_SCHEDULER: Started scheduler, checking every ${intervalMs}ms.`);
    }

    static stopScheduler() {
        if (this.schedulerIntervalId) {
            clearInterval(this.schedulerIntervalId);
            this.schedulerIntervalId = null;
            console.log('JOB_SCHEDULER: Stopped scheduler.');
        }
    }

    static async processJobQueue() {
        if (this.isProcessing) return;

        this.isProcessing = true;

        try {
            const readyJobs = this.getReadyJobs();

            for (const job of readyJobs) {
                if (this.currentlyRunning.size >= this.maxConcurrentJobs) {
                    break;
                }
                // Don't await here to allow parallel execution up to maxConcurrentJobs
                this.executeJob(job).catch(err => console.error(`JOB_SCHEDULER: Error during job execution for ${job.id}:`, err));
            }
        } finally {
            this.isProcessing = false;
        }
    }

    static getReadyJobs() {
        const now = Date.now();
        const readyJobs = [];

        for (const job of this.jobs.values()) {
            if (job.nextRun <= now &&
                (job.status === 'scheduled' || (job.status === 'failed' && job.retryCount < job.options.maxRetries)) && // Includes retries
                !this.currentlyRunning.has(job.id)) {
                readyJobs.push(job);
            }
        }

        return readyJobs.sort((a, b) => {
            const priorityOrder = { 'high': 0, 'normal': 1, 'low': 2 };
            const priorityDiff = priorityOrder[a.options.priority] - priorityOrder[b.options.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return a.nextRun - b.nextRun; // Earliest next run first
        });
    }

    static async executeJob(job) {
        this.currentlyRunning.add(job.id);
        job.status = 'running';
        job.startedAt = Date.now();
        job.lastError = null;

        console.log(`JOB_SCHEDULER: Executing job: ${job.id}`);

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Job timed out after ${job.options.timeout}ms`)), job.options.timeout)
        );

        try {
            await Promise.race([
                job.function(),
                timeoutPromise
            ]);

            this.handleJobSuccess(job);

        } catch (error) {
            if (error.message.includes('Job timed out')) { // Check specifically for timeout error
                this.handleJobTimeout(job);
            } else {
                await this.handleJobError(job, error);
            }
        } finally {
            this.currentlyRunning.delete(job.id);
            // Delete one-time jobs after completion or terminal failure
            if (typeof job.schedule === 'number' && (job.status === 'completed' || (job.status === 'failed' && job.retryCount >= job.options.maxRetries))) {
                this.removeJob(job.id); // Permanently remove one-time jobs
            }
        }
    }

    static handleJobSuccess(job) {
        job.status = 'completed';
        job.lastRun = Date.now();
        job.retryCount = 0;
        job.executionTime = Date.now() - job.startedAt;

        console.log(`JOB_SCHEDULER: Job completed: ${job.id} in ${job.executionTime}ms`);

        // For recurring jobs, schedule next run
        if (typeof job.schedule !== 'number') {
            job.nextRun = this.calculateNextRun(job.schedule);
            // Keep status as 'scheduled' so it's picked up again
            job.status = 'scheduled';
        }
    }

    static async handleJobError(job, error) {
        job.status = 'failed';
        job.lastError = error.message;
        job.retryCount++;
        job.executionTime = Date.now() - job.startedAt;

        console.error(`JOB_SCHEDULER: Job failed: ${job.id} (Error: ${error.message}). Retries left: ${job.options.maxRetries - job.retryCount}`);

        if (job.retryCount < job.options.maxRetries) {
            job.nextRun = Date.now() + (job.retryCount * 30000); // Exponential backoff (30s, 60s, 90s...)
            job.status = 'scheduled';
            console.log(`JOB_SCHEDULER: Retrying job: ${job.id} at ${new Date(job.nextRun).toLocaleString()}`);
        } else {
            await SecurityLogger.logCriticalAction('system', 'job_failed_max_retries', { // Updated path
                jobId: job.id,
                retryCount: job.retryCount,
                maxRetries: job.options.maxRetries,
                error: error.message,
                stack: error.stack?.substring(0, 1000)
            });
            console.error(`JOB_SCHEDULER: Job ${job.id} permanently failed after ${job.retryCount} retries.`);
        }
    }

    static handleJobTimeout(job) {
        job.status = 'timeout';
        job.lastError = `Job timed out after ${job.options.timeout}ms`;
        job.retryCount++;
        job.executionTime = Date.now() - job.startedAt;

        console.error(`JOB_SCHEDULER: Job timeout: ${job.id}. Retries left: ${job.options.maxRetries - job.retryCount}`);

        if (job.retryCount < job.options.maxRetries) {
            job.nextRun = Date.now() + (job.retryCount * 60000); // Longer delay for timeouts (60s, 120s...)
            job.status = 'scheduled';
            console.log(`JOB_SCHEDULER: Retrying timed out job: ${job.id} at ${new Date(job.nextRun).toLocaleString()}`);
        } else {
            console.error(`JOB_SCHEDULER: Job ${job.id} permanently failed due to timeout after ${job.retryCount} retries.`);
            SecurityLogger.logCriticalAction('system', 'job_timeout_max_retries', { // Updated path
                jobId: job.id,
                retryCount: job.retryCount,
                maxRetries: job.options.maxRetries,
                error: job.lastError
            });
        }
    }

    static removeJob(jobId) {
        this.jobs.delete(jobId);
        this.currentlyRunning.delete(jobId);
        console.log(`JOB_SCHEDULER: Removed job: ${jobId}`);
    }

    static getJobStatus(jobId = null) {
        if (jobId) {
            const job = this.jobs.get(jobId);
            return job ? {
                id: job.id,
                status: job.status,
                nextRun: new Date(job.nextRun).toISOString(),
                lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
                retryCount: job.retryCount,
                priority: job.options.priority,
                lastError: job.lastError,
                startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
                executionTime: job.executionTime ? `${job.executionTime}ms` : null
            } : null;
        }

        const status = {
            totalJobs: this.jobs.size,
            runningJobs: this.currentlyRunning.size,
            scheduledJobs: Array.from(this.jobs.values()).filter(j => j.status === 'scheduled').length,
            failedJobs: Array.from(this.jobs.values()).filter(j => j.status === 'failed' || j.status === 'timeout').length,
            completedJobs: Array.from(this.jobs.values()).filter(j => j.status === 'completed' && typeof j.schedule === 'number').length,
            jobs: {}
        };

        for (const [id, job] of this.jobs) {
            status.jobs[id] = {
                status: job.status,
                nextRun: new Date(job.nextRun).toISOString(),
                lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : 'N/A',
                retryCount: job.retryCount,
                priority: job.options.priority,
                lastError: job.lastError || 'N/A'
            };
        }

        return status;
    }

    static initializeSystemJobs() {
        // Initialize static properties/rules for classes that need it before their methods are called
        AutoCleanupService.initialize(); // Initializes cleanup rules

        this.scheduleJob('auto_cleanup', () => AutoCleanupService.runScheduledCleanup(), 'every 30 minutes', {
            priority: 'normal',
            maxRetries: 2,
            timeout: 120000 // 2 minutes
        });

        this.scheduleJob('performance_monitoring_report', () => PerformanceMonitor.generateReport(), 'every 10 minutes', { // Updated path
            priority: 'low',
            maxRetries: 1,
            timeout: 60000 // 1 minute
        });

        this.scheduleJob('cache_optimization_preload', () => AdvancedCacheManager.preloadCriticalData(), 'every hour', { // Updated path
            priority: 'low',
            maxRetries: 1,
            timeout: 60000
        });

        this.scheduleJob('security_report_generation', () => EnhancedSecurityMonitoring.generateSecurityReport('1h'), 'every 30 minutes', { // Updated path
            priority: 'high',
            maxRetries: 3,
            timeout: 120000
        });

        this.scheduleJob('resource_monitoring_snapshot', () => SmartResourceManager.monitorSystemResources(), 'every 5 minutes', { // Updated path
            priority: 'normal',
            maxRetries: 1,
            timeout: 30000
        });

        this.scheduleJob('driver_spatial_index_cleanup', () => OptimizedDriverSearch.cleanupOldIndexEntries(), 'every 10 minutes', { // Updated path
            priority: 'normal',
            maxRetries: 2,
            timeout: 60000
        });

        this.scheduleJob('demand_prediction_update', () => PredictiveAnalytics.predictOrderDemand('1h'), 'every 15 minutes', { // Updated path
            priority: 'normal',
            maxRetries: 2,
            timeout: 60000
        });

        this.scheduleJob('driver_utilization_prediction_update', () => PredictiveAnalytics.predictDriverUtilization(), 'every 30 minutes', { // Updated path
            priority: 'normal',
            maxRetries: 2,
            timeout: 60000
        });

        console.log('JOB_SCHEDULER: System jobs initialized.');
    }
}

module.exports = BackgroundJobScheduler;