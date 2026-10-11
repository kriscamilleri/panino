// /backend/api-service/mailer.js
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, FRONTEND_URL } = process.env;

export function buildSpaceInviteUrl(token) {
    const baseUrl = (FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return `${baseUrl}/#/spaces/invitations/${token}`;
}

export function buildEmailVerificationUrl(token) {
    const baseUrl = (FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return `${baseUrl}/#/verify-email/${token}`;
}

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: (SMTP_PORT === '465'), // true for 465, false for other ports
    ...(SMTP_USER && SMTP_PASS ? {
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
        },
    } : {}),
});

export async function sendPasswordResetEmail(to, token) {
    const resetLink = `${FRONTEND_URL || 'http://localhost:5173'}/#/reset-password/${token}`;
    const mailOptions = {
        from: `Panino <${SMTP_FROM}>`,
        to: to,
        subject: 'Your Panino Password Reset Request',
        text: `You requested a password reset. Click this link to reset your password: ${resetLink}\n\nThis link will expire in 1 hour.`,
        html: `<p>You requested a password reset. Click this link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link will expire in 1 hour.</p>`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Password reset email sent to ${to}`);
    } catch (error) {
        console.error(`Error sending password reset email to ${to}:`, error);
        // In a real app, you'd have more robust error handling here
    }
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

export async function sendSpaceInviteEmail(to, token, spaceName) {
    const inviteLink = buildSpaceInviteUrl(token);
    const safeLink = escapeHtml(inviteLink);
    // The name is chosen by the inviter. Keep it on one line.
    const plainSpaceName = String(spaceName).replace(/\s+/g, ' ').trim();
    const safeSpaceName = escapeHtml(plainSpaceName);
    spaceName = plainSpaceName;
    const mailOptions = {
        from: `Panino <${SMTP_FROM}>`,
        // An address object, never a string: a string is parsed as a list, so
        // "a@x.com, b@y.com" would be two recipients.
        to: { name: '', address: to },
        subject: 'You were invited to a Panino space',
        text: `You were invited to collaborate in “${spaceName}”. Open this link while signed in to the invited email address: ${inviteLink}\n\nThis invitation expires in 7 days.`,
        html: `<p>You were invited to collaborate in <strong>${safeSpaceName}</strong>.</p><p><a href="${safeLink}">Accept invitation</a></p><p>Sign in with the invited email address. This invitation expires in 7 days.</p>`,
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('[mailer] Failed to send a space invitation:', error?.message || 'unknown error');
        return false;
    }
}

/**
 * Mail the link that proves the account's address reaches its holder.
 * Resolves to whether the message was handed to the mail server.
 */
export async function sendEmailVerificationEmail(to, token) {
    const link = buildEmailVerificationUrl(token);
    const safeLink = escapeHtml(link);
    const mailOptions = {
        from: `Panino <${SMTP_FROM}>`,
        // An address object, never a string (see sendSpaceInviteEmail).
        to: { name: '', address: to },
        subject: 'Verify your email address for Panino',
        text: `Someone signed in to a Panino account that uses this email address asked to verify it.\n\nOpen this link in the browser where you are signed in to Panino, then choose Verify email address: ${link}\n\nThe link expires in 24 hours and works only while signed in to that account. If you did not ask for this, ignore this email; nothing changes.`,
        html: `<p>Someone signed in to a Panino account that uses this email address asked to verify it.</p><p><a href="${safeLink}">Verify this email address</a></p><p>Open the link in the browser where you are signed in to Panino. It expires in 24 hours and works only while signed in to that account. If you did not ask for this, ignore this email; nothing changes.</p>`,
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('[mailer] Failed to send an email verification:', error?.message || 'unknown error');
        return false;
    }
}
