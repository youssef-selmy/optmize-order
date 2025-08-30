// 029-auto-cleanup-service.js (Original: AutoCleanupService.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path
const CacheManager = require('./CacheManager'); // For in-memory cleanup - Assuming CacheManager.js is renamed to 017-redis-caching-performance.js OR 003-utilities-helpers.js
const AdvancedCacheManager = require('./026-advanced-cache-manager'); // For in-memory cleanup
const OptimizedDriverSearch = require('./023-optimized-driver-search'); // For in-memory cleanup (Updated path)

class AutoCleanupService {
    static cleanupRules = new Map();
    static lastCleanup = new Map();

    static initialize() {
        this.cleanupRules.set('expired_orders', {
            collection: 'restaurant_orders',
            condition: {
                field: 'createdAt',
                operator: '<=',
                value: () => _admin.firestore.Timestamp.fromDate(new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))) // Orders older than 7 days
            },
            batchSize: 50,
            intervalMinutes: 60
        });

        this.cleanupRules.set('old_security_logs', {
            collection: 'security_logs',
            condition: {
                field: 'timestamp',
                operator: '<=',
                value: () => _admin.firestore.Timestamp.fromDate(new Date(Date.now() - (30 * 24 * 60 * 60 * 1000))) // Logs older than 30 days
            },
            batchSize: 100,
            intervalMinutes: 120
        });

        this.cleanupRules.set('expired_notifications', {
            collection: 'notification_logs',
            condition: {
                field: 'timestamp',
                operator: '<=',
                value: () => _admin.firestore.Timestamp.fromDate(new Date(Date.now() - (14 * 24 * 60 * 60 * 1000))) // Notifications older than 14 days
            },
            batchSize: 100,
            intervalMinutes: 180
        });

        this.cleanupRules.set('old_performance_alerts', { // Renamed from metrics to match collection
            collection: 'performance_alerts',
            condition: {
                field: 'timestamp',
                operator: '<=',
                value: () => _admin.firestore.Timestamp.fromDate(new Date(Date.now() - (7 * 24 * 60 * 60 * 1000))) // Alerts older than 7 days
            },
            batchSize: 50,
            intervalMinutes: 240
        });

        // Initialize lastCleanup timestamps (for first run, set to 0)
        for (const ruleName of this.cleanupRules.keys()) {
            this.lastCleanup.set(ruleName, 0); // Ensures all rules run on first schedule check
        }

        console.log('AutoCleanupService: Initialized cleanup rules.');
    }

    static async runScheduledCleanup() {
        console.log('AUTO_CLEANUP: Starting scheduled cleanup cycle...');

        for (const [ruleName, rule] of this.cleanupRules) {
            try {
                const lastRun = this.lastCleanup.get(ruleName) || 0;
                const now = Date.now();
                const intervalPerhaps = rule.intervalMinutes * 60 * 1000;

                if (now - lastRun >= intervalPerhaps) {
                    console.log(`AUTO_CLEANUP: Interval reached for rule '${ruleName}'. Executing...`);
                    await this.executeCleanupRule(ruleName, rule);
                    this.lastCleanup.set(ruleName, now);
                } else {
                    console.log(`AUTO_CLEANUP: Rule '${ruleName}' not due yet. Next run in ${Math.ceil((lastRun + intervalPerhaps - now) / 60000)} minutes.`);
                }
            } catch (error) {
                console.error(`AUTO_CLEANUP: Failed to execute cleanup rule '${ruleName}':`, error);
                await SecurityLogger.logCriticalAction('system', 'cleanup_rule_failed', { // Updated path
                    rule: ruleName,
                    error: error.message
                });
            }
        }

        console.log('AUTO_CLEANUP: Scheduled cleanup cycle completed.');
    }

    static async executeCleanupRule(ruleName, rule) {
        let deletedCount = 0;
        let continueCleanup = true;
        const conditionValue = typeof rule.condition.value === 'function' ?
            rule.condition.value() : rule.condition.value;

        while (continueCleanup) {
            try {
                const query = _firestore.collection(rule.collection)
                    .where(rule.condition.field, rule.condition.operator, conditionValue)
                    .limit(rule.batchSize);

                const snapshot = await query.get();

                if (snapshot.empty) {
                    continueCleanup = false;
                    break;
                }

                const batch = _firestore.batch();
                snapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });

                await batch.commit();
                deletedCount += snapshot.docs.length;

                console.log(`AUTO_CLEANUP: Deleted batch of ${snapshot.docs.length} documents from '${rule.collection}' for rule '${ruleName}'. Total: ${deletedCount}`);

                if (snapshot.docs.length < rule.batchSize) {
                    continueCleanup = false;
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Small pause
                }
            } catch (error) {
                console.error(`AUTO_CLEANUP: Error during batch deletion for rule '${ruleName}':`, error);
                continueCleanup = false;
                throw error;
            }
        }
        console.log(`AUTO_CLEANUP: Rule '${ruleName}' completed. Total documents deleted: ${deletedCount}.`);
        return deletedCount;
    }

    static async cleanupInMemoryData() {
        console.log('AUTO_CLEANUP: Triggering in-memory data cleanup across modules...');
        // Clear caches and metrics from other modules that hold in-memory state
        CacheManager.cache.clear(); // Assuming CacheManager.js is renamed correctly
        AdvancedCacheManager.cache.clear();
        OptimizedDriverSearch.spatialIndex.clear(); // Clear spatial index

        console.log('AUTO_CLEANUP: All in-memory caches cleared.');
    }

    static async forceCleanupRule(ruleName) {
        const rule = this.cleanupRules.get(ruleName);
        if (!rule) {
            throw new Error(`Cleanup rule "${ruleName}" not found.`);
        }

        console.log(`AUTO_CLEANUP: Forcing execution of cleanup rule: ${ruleName}`);
        try {
            const count = await this.executeCleanupRule(ruleName, rule);
            this.lastCleanup.set(ruleName, Date.now());
            console.log(`AUTO_CLEANUP: Forced cleanup of rule '${ruleName}' completed. Deleted ${count} documents.`);
            return count;
        } catch (error) {
            console.error(`AUTO_CLEANUP: Forced cleanup of rule '${ruleName}' failed:`, error);
            throw error;
        }
    }

    static getCleanupStatus() {
        const status = {};

        for (const [ruleName, rule] of this.cleanupRules) {
            const lastRun = this.lastCleanup.get(ruleName);
            const nextRunTime = lastRun ? lastRun + (rule.intervalMinutes * 60 * 1000) : Date.now();

            status[ruleName] = {
                collection: rule.collection,
                intervalMinutes: rule.intervalMinutes,
                lastRun: lastRun ? new Date(lastRun).toISOString() : 'Never',
                nextRun: new Date(nextRunTime).toISOString(),
                overdue: nextRunTime < Date.now()
            };
        }
        return status;
    }
}

module.exports = AutoCleanupService;