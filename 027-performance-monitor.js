// 027-performance-monitor.js (Original: PerformanceMonitor.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path
const AdvancedNotificationService = require('./022-multi-channel-notifications'); // For alerts (Updated path)
const SmartResourceManager = require('./024-smart-resource-management'); // For memory thresholds (Updated path)

class PerformanceMonitor {
    static metrics = new Map(); // Map<functionName, [{executionTime, memoryDelta, success, error, timestamp}, ...]>
    static alerts = []; // Stores recent triggered alerts
    static thresholds = {
        responseTime: 5000, // ms (5 seconds)
        memoryUsage: 128 * 1024 * 1024, // bytes (128 MB heap delta)
        errorRate: 5, // %
        queueLength: 50 // (Example for queue monitoring)
    };

    static async trackFunction(functionName, executionFunction) {
        const startTime = Date.now();
        let startMemory = { heapUsed: 0, heapTotal: 0, external: 0 };
        if (typeof process !== 'undefined' && process.memoryUsage) {
            startMemory = process.memoryUsage();
        }

        try {
            const result = await executionFunction();

            const endTime = Date.now();
            const executionTime = endTime - startTime;
            let endMemory = { heapUsed: 0, heapTotal: 0, external: 0 };
            if (typeof process !== 'undefined' && process.memoryUsage) {
                endMemory = process.memoryUsage();
            }

            this.recordMetric(functionName, {
                executionTime,
                memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
                success: true,
                timestamp: endTime
            });

            if (executionTime > this.thresholds.responseTime) {
                await this.generateAlert('SLOW_EXECUTION', functionName, {
                    executionTime,
                    threshold: this.thresholds.responseTime
                });
            }
            if ((endMemory.heapUsed - startMemory.heapUsed) > this.thresholds.memoryUsage) {
                await this.generateAlert('HIGH_MEMORY_USAGE', functionName, {
                    memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
                    threshold: this.thresholds.memoryUsage
                });
            }

            return result;

        } catch (error) {
            this.recordMetric(functionName, {
                executionTime: Date.now() - startTime,
                memoryDelta: 0, // Cannot reliably calculate delta on error exit
                success: false,
                error: error.message,
                timestamp: Date.now(),
                stack: error.stack?.substring(0, 500) // Log partial stack
            });

            throw error;
        }
    }

    static recordMetric(functionName, metric) {
        if (!this.metrics.has(functionName)) {
            this.metrics.set(functionName, []);
        }

        const functionMetrics = this.metrics.get(functionName);
        functionMetrics.push(metric);

        if (functionMetrics.length > 200) {
            functionMetrics.splice(0, functionMetrics.length - 100);
        }
    }

    static async generateAlert(type, functionName, details) {
        const alert = {
            type,
            functionName,
            details,
            timestamp: Date.now(),
            id: `${type}_${functionName}_${Date.now()}`
        };

        this.alerts.push(alert);

        if (this.alerts.length > 100) {
            this.alerts.splice(0, 50);
        }

        await _firestore.collection('performance_alerts').add(alert);

        console.error(`PERFORMANCE_ALERT: ${type} detected in function "${functionName}". Details:`, JSON.stringify(details, null, 2));

        // Notify admins for critical performance issues
        if (type === 'SLOW_EXECUTION' || type === 'HIGH_MEMORY_USAGE') {
            AdvancedNotificationService.sendMultiChannelNotification(
                { role: 'admin', email: 'devops@example.com', /* slack info */ }, // Mock recipient
                { title: `Performance Alert: ${type}`, body: `Function ${functionName} exceeded threshold. Details: ${JSON.stringify(details)}` },
                'normal', ['email', 'slack']
            ).catch(err => console.error("Failed to send performance alert notification:", err.message));
        }
    }

    static getPerformanceReport(functionName = null) {
        if (functionName) {
            return this.generateFunctionReport(functionName);
        }

        const report = {
            overview: this.generateOverviewReport(),
            functions: {},
            alerts: this.alerts.slice(-20),
            timestamp: new Date().toISOString()
        };

        for (const [name] of this.metrics) {
            report.functions[name] = this.generateFunctionReport(name);
        }

        return report;
    }

    static generateFunctionReport(functionName) {
        const metrics = PerformanceMonitor.metrics.get(functionName) || [];

        if (metrics.length === 0) {
            return { noData: true };
        }

        const successfulMetrics = metrics.filter(m => m.success);
        const failedMetrics = metrics.filter(m => !m.success);

        const executionTimes = successfulMetrics.map(m => m.executionTime).filter(Number.isFinite);
        const memoryDeltas = successfulMetrics.map(m => m.memoryDelta).filter(Number.isFinite);

        return {
            totalExecutions: metrics.length,
            successRate: ((successfulMetrics.length / metrics.length) * 100).toFixed(2) + '%',
            averageExecutionTime: executionTimes.length > 0 ?
                (executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length).toFixed(2) + 'ms' : 'N/A',
            maxExecutionTime: executionTimes.length > 0 ? Math.max(...executionTimes) + 'ms' : 'N/A',
            minExecutionTime: executionTimes.length > 0 ? Math.min(...executionTimes) + 'ms' : 'N/A',
            averageMemoryDelta: memoryDeltas.length > 0 ?
                (memoryDeltas.reduce((a, b) => a + b, 0) / memoryDeltas.length / 1024).toFixed(2) + 'KB' : 'N/A',
            errorCount: failedMetrics.length,
            recentErrors: failedMetrics.slice(-5).map(m => ({
                message: m.error,
                timestamp: new Date(m.timestamp).toISOString(),
                stack: m.stack
            }))
        };
    }

    static generateOverviewReport() {
        const allMetrics = Array.from(this.metrics.values()).flat();
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentMetrics = allMetrics.filter(m => m.timestamp > oneHourAgo);

        let currentHeapUsed = 0;
        if (typeof process !== 'undefined' && process.memoryUsage) {
            currentHeapUsed = process.memoryUsage().heapUsed;
        }


        return {
            totalFunctionsTracked: this.metrics.size,
            recentExecutions: recentMetrics.length,
            recentErrors: recentMetrics.filter(m => !m.success).length,
            systemHealth: this.calculateSystemHealth(recentMetrics),
            activeAlerts: this.alerts.filter(a => a.timestamp > oneHourAgo).length,
            currentMemoryUsage: `${Math.round(currentHeapUsed / 1024 / 1024)}MB`
        };
    }

    static calculateSystemHealth(metrics) {
        if (metrics.length === 0) return 'UNKNOWN';

        const errorRate = (metrics.filter(m => !m.success).length / metrics.length) * 100;
        const totalExecutionTime = metrics.reduce((sum, m) => sum + (m.executionTime || 0), 0);
        const avgExecutionTime = totalExecutionTime / metrics.length;
        let currentHeapUsed = 0;
        if (typeof process !== 'undefined' && process.memoryUsage) {
            currentHeapUsed = process.memoryUsage().heapUsed;
        }


        if (errorRate > 10 || avgExecutionTime > 10000 || currentHeapUsed > SmartResourceManager.resourceLimits.maxMemoryUsage * 0.9) return 'CRITICAL'; // Updated path
        if (errorRate > 5 || avgExecutionTime > 5000 || currentHeapUsed > SmartResourceManager.resourceLimits.maxMemoryUsage * 0.75) return 'WARNING'; // Updated path
        if (errorRate > 2 || avgExecutionTime > 2000) return 'FAIR';
        return 'GOOD';
    }

    static async generateReport() {
        console.log("PerformanceMonitor: Generating full performance report.");
        const report = this.getPerformanceReport();
        await _firestore.collection('performance_reports').add({
            ...report,
            generatedAt: _admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("Performance report saved.");
        return report;
    }
}

module.exports = PerformanceMonitor;