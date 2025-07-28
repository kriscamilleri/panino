// /backend/api-service/mailer.js
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, FRONTEND_URL } = process.env;

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: (SMTP_PORT === '465'), // true for 465, false for other ports
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
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