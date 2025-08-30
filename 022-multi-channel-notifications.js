// 022-multi-channel-notifications.js (Original: AdvancedNotificationService.js)
const { _admin, _firestore, _functions } = require('./001-setup-initialization'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path
const AdvancedSecurityManager = require('./016-advanced-security-auth'); // For mock recipient in alerts (Updated path)

class AdvancedNotificationService {
    static async sendMultiChannelNotification(recipient, message, priority = 'normal', channels = ['fcm']) {
        const results = {};

        for (const channel of channels) {
            try {
                switch (channel) {
                    case 'fcm':
                        results.fcm = await this.sendFCMNotification(recipient, message);
                        break;
                    case 'sms':
                        results.sms = await this.sendSMSNotification(recipient, message);
                        break;
                    case 'email':
                        results.email = await this.sendEmailNotification(recipient, message);
                        break;
                    case 'webhook':
                        results.webhook = await this.sendWebhookNotification(recipient, message);
                        break;
                    case 'slack':
                        results.slack = await this.sendSlackNotification(recipient, message);
                        break;
                    default:
                        results[channel] = { success: false, error: 'Unknown channel' };
                }
            } catch (error) {
                results[channel] = { success: false, error: error.message };
            }
        }

        await this.logNotificationDelivery(recipient, message, priority, results);

        return results;
    }

    static async sendFCMNotification(recipient, message) {
        if (!recipient.fcmToken) {
            throw new Error('No FCM token available');
        }

        await _admin.messaging().send({
            notification: {
                title: message.title,
                body: message.body
            },
            token: recipient.fcmToken,
            data: message.data || {},
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: message.channelId || 'orders'
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1
                    }
                }
            }
        });

        return { success: true, channel: 'fcm' };
    }

    static async sendSMSNotification(recipient, message) {
        if (!recipient.phoneNumber) {
            throw new Error('No phone number available');
        }

        console.log(`MOCK SMS: Sending to ${recipient.phoneNumber}: ${message.body}`);
        // In a real app, integrate with Twilio, Nexmo, etc.
        return { success: true, channel: 'sms' };
    }

    static async sendEmailNotification(recipient, message) {
        if (!recipient.email) {
            throw new Error('No email available');
        }

        console.log(`MOCK EMAIL: Sending to ${recipient.email}: Subject - "${message.title}", Body - "${message.body}"`);
        // In a real app, integrate with SendGrid, Mailgun, Nodemailer, etc.
        return { success: true, channel: 'email' };
    }

    static async sendWebhookNotification(recipient, message) {
        if (!recipient.webhookUrl) {
            throw new Error('No webhook URL available');
        }

        console.log(`MOCK WEBHOOK: Sending to ${recipient.webhookUrl}:`, message);
        // In a real app, use axios or fetch to POST to the webhook URL
        return { success: true, channel: 'webhook' };
    }

    static async sendSlackNotification(recipient, message) {
        console.log(`MOCK SLACK: Sending notification:`, message);
        // In a real app, use Slack API to send message to a channel or user
        return { success: true, channel: 'slack' };
    }

    static async logNotificationDelivery(recipient, message, priority, results) {
        await _firestore.collection('notification_logs').add({
            recipientId: recipient.id || recipient.uid,
            recipientType: recipient.role || 'unknown',
            message: {
                title: message.title,
                body: message.body?.substring(0, 100)
            },
            priority,
            results,
            timestamp: _admin.firestore.FieldValue.serverTimestamp(),
            successful: Object.values(results).some(r => r.success === true)
        });
    }

    static async getOptimalNotificationChannels(recipient, message, priority) {
        const channels = ['fcm'];

        if (priority === 'critical') {
            if (recipient.phoneNumber) channels.push('sms');
            if (recipient.email) channels.push('email');
        }

        if (priority === 'urgent' && recipient.phoneNumber) {
            channels.push('sms');
        }

        if (recipient.role === 'admin') {
            channels.push('slack');
        }

        return [...new Set(channels)].filter(channel => {
            if (channel === 'fcm') return !!recipient.fcmToken;
            if (channel === 'sms') return !!recipient.phoneNumber;
            if (channel === 'email') return !!recipient.email;
            if (channel === 'webhook') return !!recipient.webhookUrl;
            // For Slack/other specific channels, add specific checks for recipient data
            return true;
        });
    }
}

module.exports = AdvancedNotificationService;