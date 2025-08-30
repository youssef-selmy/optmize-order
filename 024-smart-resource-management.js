// 024-smart-resource-management.js (Original: SmartResourceManager.js)
const { _admin, _firestore, _functions } = require('./001-setup-initialization'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path
const { ORDER_STATUS } = require('./002-constants-definition'); // Updated path
const CacheManager = require('./CacheManager'); // For memory cleanup - Assuming CacheManager.js is renamed to 017-redis-caching-performance.js OR 003-utilities-helpers.js
const AdvancedCacheManager = require('./026-advanced-cache-manager'); // For memory cleanup
const OptimizedDriverSearch = require('./023-optimized-driver-search'); // For memory cleanup (Updated path)

class SmartResourceManager {
    static resourceLimits = {
        maxConcurrentDispatch: 100,
        maxMemoryUsage: 512 * 1024 * 1024, // 512 MB heapUsed limit
        maxCPUUsage: 80, // Percentage
        maxDatabaseConnections: 50 // Limit for concurrent active DB connections
    };

    static resourceUsage = {
        activeDispatch: 0,
        memoryUsage: 0, // Current heapUsed in bytes
        cpuUsage: 0, // Current CPU utilization percentage (approx)
        databaseConnections: 0 // Current active database connections (approx)
    };

    static async acquireResource(resourceType, amount = 1) {
        const limitKey = `max${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}`;
        const limit = this.resourceLimits[limitKey];

        if (typeof limit === 'undefined') {
            throw new Error(`Undefined resource type: ${resourceType}`);
        }

        const currentUsage = this.resourceUsage[resourceType] || 0;

        if (currentUsage + amount > limit) {
            await this.handleResourceExhaustion(resourceType, currentUsage, limit, amount);
            throw new _functions.https.HttpsError('resource-exhausted',
                `Resource limit exceeded for ${resourceType}: ${currentUsage + amount}/${limit}`);
        }

        this.resourceUsage[resourceType] = currentUsage + amount;

        return {
            release: () => this.releaseResource(resourceType, amount),
            resourceType,
            amount
        };
    }

    static releaseResource(resourceType, amount = 1) {
        this.resourceUsage[resourceType] = Math.max(0, (this.resourceUsage[resourceType] || 0) - amount);
    }

    static async handleResourceExhaustion(resourceType, current, limit, requested) {
        await _firestore.collection('resource_alerts').add({
            type: 'resource_exhaustion',
            resourceType,
            currentUsage: current,
            limit,
            requestedAmount: requested,
            timestamp: _admin.firestore.FieldValue.serverTimestamp()
        });

        if (resourceType === 'activeDispatch') {
            await this.prioritizeHighValueOrders();
        }

        await SecurityLogger.logCriticalAction('system', 'resource_exhaustion', {
            resourceType,
            currentUsage: current,
            limit,
            requestedAmount: requested
        });
    }

    static async prioritizeHighValueOrders() {
        const pendingOrders = await _firestore.collection('restaurant_orders')
            .where('status', '==', ORDER_STATUS.DRIVER_PENDING)
            .orderBy('totalAmount', 'desc')
            .limit(10)
            .get();

        console.log(`Prioritizing ${pendingOrders.size} high-value orders due to resource constraints`);
        // In a real system, you might trigger a re-dispatch *only* for these orders
        // or place them into a high-priority queue.
    }

    static async monitorSystemResources() {
        const memoryUsage = typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage() : { heapUsed: 0, heapTotal: 0, external: 0 }; // Handle non-Node environments
        this.resourceUsage.memoryUsage = memoryUsage.heapUsed;

        // Simulate CPU usage (more complex in real Node.js, might use os.cpus())
        this.resourceUsage.cpuUsage = Math.floor(Math.random() * 50) + 30; // Random between 30-80%

        // Simulate Database connections (This would typically be read from a connection pool monitor)
        this.resourceUsage.databaseConnections = Math.floor(Math.random() * 20) + 10; // Random between 10-30

        if (memoryUsage.heapUsed > this.resourceLimits.maxMemoryUsage) {
            await this.performMemoryCleanup();
        }

        const stats = {
            memory: {
                used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
                external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB'
            },
            cpuUsage: this.resourceUsage.cpuUsage + '%',
            databaseConnections: `${this.resourceUsage.databaseConnections}/${this.resourceLimits.maxDatabaseConnections}`,
            activeDispatch: this.resourceUsage.activeDispatch,
            limits: this.resourceLimits
        };

        console.log('SmartResourceManager: Current System Resources:', stats);
        return stats;
    }

    static async performMemoryCleanup() {
        console.log('PERFORMANCE_ACTION: Performing emergency memory cleanup');

        // Clear in-memory caches from other modules
        CacheManager.cache.clear(); // Assuming CacheManager.js is renamed correctly
        AdvancedCacheManager.cache.clear();
        OptimizedDriverSearch.spatialIndex.clear(); // Clear spatial index

        // Trigger Node.js garbage collection (not guaranteed to run immediately)
        if (typeof global !== 'undefined' && global.gc) {
            global.gc();
        }

        await SecurityLogger.logCriticalAction('system', 'emergency_memory_cleanup', {
            memoryBefore: this.resourceUsage.memoryUsage,
            timestamp: Date.now()
        });
        console.log('PERFORMANCE_ACTION: Memory cleanup complete, current heapUsed:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB');
    }

    static async executeWithResourceManagement(operation, resourceRequirements = {}) {
        const resources = [];

        try {
            for (const [type, amount] of Object.entries(resourceRequirements)) {
                const resource = await this.acquireResource(type, amount);
                resources.push(resource);
            }

            const result = await operation();

            return result;

        } catch (error) {
            console.error('Resource-managed operation failed:', error.message);
            throw error;
        } finally {
            resources.forEach(resource => resource.release());
        }
    }

    static getResourceStatus() {
        const status = {};

        for (const [key, value] of Object.entries(this.resourceUsage)) {
            const limitKey = `max${key.charAt(0).toUpperCase() + key.slice(1)}`;
            const limit = this.resourceLimits[limitKey] || 0;

            let percentage;
            if (key === 'cpuUsage') {
                percentage = `${value.toFixed(1)}%`;
            } else {
                percentage = limit > 0 ? ((value / limit) * 100).toFixed(1) + '%' : '0%';
            }


            status[key] = {
                current: value,
                limit,
                percentage: percentage,
                available: Math.max(0, limit - value)
            };
        }

        return status;
    }
}

module.exports = SmartResourceManager;