// 001-setup-initialization.js
const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

module.exports = {
    _admin: admin,
    _firestore: db,
    _functions: functions,
};