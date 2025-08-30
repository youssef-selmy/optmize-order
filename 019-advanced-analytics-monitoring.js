// 019-advanced-analytics-monitoring.js (Original: AdvancedAnalytics.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path

class AdvancedAnalytics {
    static async trackOrderFlowMetrics(orderId, stage, metadata = {}) {
        const flowData = {
            orderId,
            stage,
            timestamp: _admin.firestore.FieldValue.serverTimestamp(),
            metadata,
            processingTime: metadata.processingTime || null
        };

        await _firestore.collection('order_flow_analytics').add(flowData);
        await this.updateRealTimeMetrics(stage, metadata);
    }

    static async updateRealTimeMetrics(stage, metadata) {
        const metricsRef = _firestore.collection('realtime_metrics').doc('current');

        await _firestore.runTransaction(async (transaction) => {
            const doc = await transaction.get(metricsRef);
            const currentMetrics = doc.exists ? doc.data() : {
                ordersProcessed: 0,
                averageProcessingTime: 0,
                stageMetrics: {},
                lastUpdated: null
            };

            currentMetrics.ordersProcessed += 1;
            currentMetrics.stageMetrics[stage] = (currentMetrics.stageMetrics[stage] || 0) + 1;

            if (metadata.processingTime !== undefined && metadata.processingTime !== null) {
                const currentAvg = currentMetrics.averageProcessingTime || 0;
                const count = currentMetrics.ordersProcessed;
                currentMetrics.averageProcessingTime =
                    ((currentAvg * (count - 1)) + metadata.processingTime) / count;
            }

            currentMetrics.lastUpdated = _admin.firestore.FieldValue.serverTimestamp();

            transaction.set(metricsRef, currentMetrics);
        });
    }

    static async generatePerformanceReport(timeframe = '24h') {
        const now = Date.now();
        const timeframeDuration = {
            '1h': 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000
        };

        const startTime = now - timeframeDuration[timeframe];

        try {
            const analyticsSnapshot = await _firestore.collection('order_flow_analytics')
                .where('timestamp', '>=', _admin.firestore.Timestamp.fromDate(new Date(startTime)))
                .get();

            const report = {
                timeframe,
                totalOrders: analyticsSnapshot.size,
                stageBreakdown: {},
                averageProcessingTimes: {},
                errorRates: {},
                generatedAt: new Date().toISOString()
            };

            analyticsSnapshot.docs.forEach(doc => {
                const data = doc.data();
                const stage = data.stage;

                report.stageBreakdown[stage] = (report.stageBreakdown[stage] || 0) + 1;

                if (data.metadata?.processingTime !== undefined && data.metadata?.processingTime !== null) {
                    if (!report.averageProcessingTimes[stage]) {
                        report.averageProcessingTimes[stage] = [];
                    }
                    report.averageProcessingTimes[stage].push(data.metadata.processingTime);
                }

                if (data.metadata?.error) {
                    report.errorRates[stage] = (report.errorRates[stage] || 0) + 1;
                }
            });

            Object.keys(report.averageProcessingTimes).forEach(stage => {
                const times = report.averageProcessingTimes[stage];
                if (times.length > 0) {
                    report.averageProcessingTimes[stage] =
                        times.reduce((a, b) => a + b, 0) / times.length;
                } else {
                    report.averageProcessingTimes[stage] = 0;
                }
            });

            return report;
        } catch (error) {
            console.error('Failed to generate performance report:', error);
            return null;
        }
    }

    static async detectAnomalies() {
        try {
            const report = await this.generatePerformanceReport('1h');
            if (!report) return;

            const anomalies = [];

            Object.entries(report.averageProcessingTimes).forEach(([stage, avgTime]) => {
                if (avgTime > 30000) { // 30 seconds
                    anomalies.push({
                        type: 'slow_processing',
                        stage,
                        value: avgTime,
                        threshold: 30000
                    });
                }
            });

            Object.entries(report.errorRates).forEach(([stage, errorCount]) => {
                const stageTotal = report.stageBreakdown[stage] || 1;
                const errorRate = (errorCount / stageTotal) * 100;

                if (errorRate > 5) { // 5% error rate
                    anomalies.push({
                        type: 'high_error_rate',
                        stage,
                        value: errorRate,
                        threshold: 5
                    });
                }
            });

            if (anomalies.length > 0) {
                await _firestore.collection('system_anomalies').add({
                    anomalies,
                    detectedAt: _admin.firestore.FieldValue.serverTimestamp(),
                    reportData: report
                });

                await _firestore.collection('admin_alerts').add({
                    type: 'system_anomaly',
                    severity: 'high',
                    anomalies,
                    timestamp: _admin.firestore.FieldValue.serverTimestamp()
                });
            }

            return anomalies;
        } catch (error) {
            console.error('Anomaly detection failed:', error);
            return [];
        }
    }
}

module.exports = AdvancedAnalytics;