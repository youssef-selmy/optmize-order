// 025-enhanced-security-monitoring.js (Original: EnhancedSecurityMonitoring.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path
const AdvancedSecurityManager = require('./016-advanced-security-auth'); // For suspicious IPs (Updated path)
const AIFraudDetection = require('./018-ai-fraud-detection'); // To cross-reference with fraud scores (Updated path)
const AdvancedNotificationService = require('./022-multi-channel-notifications'); // For alerts (Updated path)

class EnhancedSecurityMonitoring {
    static suspiciousPatterns = new Map(); // Tracks recent activities per user
    static securityMetrics = {
        totalThreats: 0,
        blockedAttempts: 0,
        fraudScoreTotal: 0,
        lastThreatDetected: null,
        highThreats: 0,
        mediumThreats: 0,
        lowThreats: 0,
    };

    static async detectAdvancedThreats(userId, activity, contextData = {}) {
        this.addActivityToPattern(userId, activity);

        const threatScore = await this.calculateThreatScore(userId, activity, contextData);

        if (threatScore >= 75) {
            await this.handleHighThreatActivity(userId, activity, threatScore, contextData);
            this.securityMetrics.highThreats++;
        } else if (threatScore >= 50) {
            await this.handleMediumThreatActivity(userId, activity, threatScore, contextData);
            this.securityMetrics.mediumThreats++;
        } else if (threatScore >= 30) {
            this.securityMetrics.lowThreats++;
        }

        await this.updateSecurityMetrics(threatScore);

        return threatScore;
    }

    static addActivityToPattern(userId, activity) {
        if (!this.suspiciousPatterns.has(userId)) {
            this.suspiciousPatterns.set(userId, []);
        }
        const userActivities = this.suspiciousPatterns.get(userId);
        userActivities.push({ activity, timestamp: Date.now() });
        // Keep a rolling window of recent activities
        if (userActivities.length > 200) {
            userActivities.splice(0, userActivities.length - 100);
        }
    }

    static async calculateThreatScore(userId, activity, contextData) {
        let score = 0;
        const factors = [];

        const sessionScore = await this.analyzeSessionBehavior(userId, contextData);
        score += sessionScore;
        if (sessionScore > 0) factors.push(`session: ${sessionScore}`);

        const networkScore = await this.analyzeNetworkPatterns(contextData);
        score += networkScore;
        if (networkScore > 0) factors.push(`network: ${networkScore}`);

        const temporalScore = this.analyzeTemporalPatterns(userId, activity);
        score += temporalScore;
        if (temporalScore > 0) factors.push(`temporal: ${temporalScore}`);

        const behaviorScore = await this.analyzeBehaviorAnomalies(userId, activity, contextData);
        score += behaviorScore;
        if (behaviorScore > 0) factors.push(`behavior: ${behaviorScore}`);

        // OPTIONAL: Integrate with AIFraudDetection's fraud score
        // This makes EnhancedSecurityMonitoring aware of fraud-specific signals
        // const fraudScore = await AIFraudDetection.calculateFraudScore(userId, activity, contextData);
        // score += fraudScore * 0.5; // Example: Add 50% of direct fraud score to general threat score
        // if (fraudScore > 0) factors.push(`ai_fraud: ${fraudScore}`);

        await SecurityLogger.logCriticalAction(userId, 'threat_score_calculated', { // Updated path
            activity,
            score: Math.min(score, 100),
            factors,
            contextData
        });

        return Math.min(score, 100);
    }

    static async analyzeSessionBehavior(userId, contextData) {
        let score = 0;

        if (contextData.multipleDevices) { // Assumes this is a flag from context
            score += 20; // Simultaneous login from different device types
        }
        if (contextData.rapidLocationChanges) { // Assumes this is a flag from context
            score += 30; // Impossible travel scenario
        }
        if (contextData.unusualUserAgent) { // Assumes this is a flag from context
            score += 15; // User-agent spoofing or unknown agent
        }
        if (contextData.excessiveFailedLogins) {
            score += 25; // Brute forcing or credential stuffing attempt
        }
        return score;
    }

    static async analyzeNetworkPatterns(contextData) {
        let score = 0;
        const { clientIP } = contextData;

        if (AdvancedSecurityManager.suspiciousIPs.has(clientIP)) { // Assuming path is correct
            score += 40; // Known suspicious IP from our own system
        }
        if (await this.isKnownMaliciousIP(clientIP)) {
            score += 60; // IP found in external blacklists
        }
        if (contextData.vpnDetected) {
            score += 10; // VPN/Proxy use (might be legitimate, but worth noting)
        }
        if (contextData.torDetected) {
            score += 35; // TOR exit node (higher risk)
        }
        return score;
    }

    static analyzeTemporalPatterns(userId, activity) {
        let score = 0;
        const hour = new Date().getHours();

        if (hour >= 0 && hour <= 5) { // Unusually late/early hours
            score += 15;
        }

        if (this.hasRapidActionPattern(userId, activity)) {
            score += 25; // Suspiciously high frequency of actions
        }

        // Check for activity at unusual intervals (e.g., highly consistent, bot-like action timing)
        // This would require more sophisticated analysis of the timestamp array in suspiciousPatterns

        return score;
    }

    static async analyzeBehaviorAnomalies(userId, activity, contextData) {
        let score = 0;

        // Delegate to AIFraudDetection for behavioral anomaly detection
        const aiBehaviorScore = await AIFraudDetection.checkBehaviorPatterns(userId, activity, contextData); // Assuming path is correct
        score += aiBehaviorScore * 0.8; // Give significant weight to AI-detected anomalies

        if (contextData.automatedBehaviorDetected) {
            score += 40; // Detected as bot/scripted behavior
        }
        if (contextData.unusualTransactionPattern) {
            score += 30; // Transaction deviates from user's normal spending/ordering habits
        }
        return score;
    }

    // Helper methods
    static async isKnownMaliciousIP(ip) {
        try {
            const maliciousDoc = await _firestore.collection('malicious_ips').doc(ip).get();
            return maliciousDoc.exists;
        } catch (error) {
            console.error(`Error checking malicious IP DB: ${error.message}`);
            return false;
        }
    }

    static hasRapidActionPattern(userId, activity) {
        const pattern = this.suspiciousPatterns.get(userId);
        if (!pattern || pattern.length < 5) return false;

        const oneMinuteAgo = Date.now() - 60000;
        const recentSpecificActions = pattern.filter(entry =>
            entry.activity === activity && entry.timestamp > oneMinuteAgo
        );
        const recentTotalActions = pattern.filter(entry =>
            entry.timestamp > oneMinuteAgo
        );

        if (recentSpecificActions.length > 5) return true; // More than 5 same actions in 1 min
        if (recentTotalActions.length > 15) return true; // More than 15 total actions in 1 min

        return false;
    }

    static async getUserNormalBehavior(userId) {
        try {
            const behaviorDoc = await _firestore.collection('user_behavior_patterns').doc(userId).get();
            return behaviorDoc.exists ? behaviorDoc.data() : null;
        } catch (error) {
            console.error(`Error fetching user normal behavior: ${error.message}`);
            return null;
        }
    }

    static async handleHighThreatActivity(userId, activity, score, contextData) {
        await _firestore.collection('users').doc(userId).update({
            securityFlag: 'HIGH_THREAT',
            flaggedAt: _admin.firestore.FieldValue.serverTimestamp(),
            threatScore: score,
            lastThreatActivity: activity,
            suspended: score > 95 // Auto-suspend if extremely high score
        });

        await _firestore.collection('security_incidents').add({
            userId,
            activity,
            threatScore: score,
            severity: 'HIGH',
            contextData,
            timestamp: _admin.firestore.FieldValue.serverTimestamp(),
            autoActions: ['account_flagged', 'admin_notified', ...(score > 95 ? ['account_suspended'] : [])]
        });

        await SecurityLogger.logCriticalAction(userId, 'high_threat_detected', { // Updated path
            activity,
            score,
            autoActions: `account_flagged${score > 95 ? ', account_suspended' : ''}`
        });

        // Send urgent notification to security team
        await AdvancedNotificationService.sendMultiChannelNotification(
            { role: 'admin', email: 'security@example.com', /* slack info */ }, // Mock recipient info
            { title: 'CRITICAL: High Security Threat Detected', body: `User ${userId} detected with high threat score (${score}) during '${activity}'. Review immediately.` },
            'critical', ['email', 'slack']
        ).catch(err => console.error("Failed to send critical security alert notification:", err.message));
    }

    static async handleMediumThreatActivity(userId, activity, score, contextData) {
        await _firestore.collection('security_incidents').add({
            userId,
            activity,
            threatScore: score,
            severity: 'MEDIUM',
            contextData,
            timestamp: _admin.firestore.FieldValue.serverTimestamp(),
            requiresReview: true
        });

        await SecurityLogger.logCriticalAction(userId, 'medium_threat_detected', { // Updated path
            activity,
            score
        });

        // Send notification for review
        await AdvancedNotificationService.sendMultiChannelNotification(
            { role: 'admin', email: 'security@example.com' }, // Mock recipient info
            { title: 'Security Alert: Medium Threat Detected', body: `User ${userId} detected with medium threat score (${score}) during '${activity}'. Review may be required.` },
            'urgent', ['email', 'slack']
        ).catch(err => console.error("Failed to send medium security alert notification:", err.message));
    }

    static async updateSecurityMetrics(threatScore) {
        this.securityMetrics.totalThreats++;
        this.securityMetrics.fraudScoreTotal += threatScore;

        // If score is above a certain threshold, consider it a blocked attempt (even if not explicitly blocked by ASM)
        if (threatScore >= 50) {
            this.securityMetrics.blockedAttempts++;
            this.securityMetrics.lastThreatDetected = Date.now();
        }
    }

    static getSecurityMetrics() {
        return {
            ...this.securityMetrics,
            averageThreatScore: this.securityMetrics.totalThreats > 0 ?
                (this.securityMetrics.fraudScoreTotal / this.securityMetrics.totalThreats).toFixed(2) : 0,
            lastThreatDetected: this.securityMetrics.lastThreatDetected ?
                new Date(this.securityMetrics.lastThreatDetected).toISOString() : null
        };
    }

    static async generateSecurityReport(timeframe = '24h') {
        console.log(`EnhancedSecurityMonitoring: Generating security report for last ${timeframe}`);
        // In a real scenario, this would query security_incidents and other logs
        // and aggregate data for a dashboard or PDF report.
        const now = Date.now();
        const timePeriod = {
            '1h': 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000
        }[timeframe] || (24 * 60 * 60 * 1000); // Default to 24h

        const incidentsSnapshot = await _firestore.collection('security_incidents')
            .where('timestamp', '>=', _admin.firestore.Timestamp.fromDate(new Date(now - timePeriod)))
            .get();

        const report = {
            timeframe,
            totalIncidents: incidentsSnapshot.size,
            highSeverityIncidents: incidentsSnapshot.docs.filter(doc => doc.data().severity === 'HIGH').length,
            mediumSeverityIncidents: incidentsSnapshot.docs.filter(doc => doc.data().severity === 'MEDIUM').length,
            // Example: top 5 suspicious IPs (this would require aggregating from logs)
            topSuspiciousIPs: ["192.168.1.1", "10.0.0.1"], // Mock, real impl would process logs
            generatedAt: new Date().toISOString(),
            metricsSnapshot: this.getSecurityMetrics()
        };

        // Persist report to Firestore or storage
        await _firestore.collection('security_reports').add(report);
        console.log("Security Report Generated and Saved:", report);
        return report;
    }
}

module.exports = EnhancedSecurityMonitoring;
