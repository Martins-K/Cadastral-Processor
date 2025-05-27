// sendMail.js
import nodemailer from "nodemailer";
import fs from 'fs';
import path from 'path';

async function sendEmail(subject, text, attachmentPath, attachmentFilename, recipientEmails = []) {
  // Create email transporter
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "martins.kruklis@gmail.com",
      pass: "eoao goty nnvf okrp"
    }
  });

  // If no recipients provided, use default
  const recipients = recipientEmails.length > 0 ? recipientEmails : ["rudolfs.kruklis@gmail.com"];
  
  // Prepare email options
  const mailOptions = {
    from: '"Cadastral Checker" <martins.kruklis@gmail.com>',
    to: recipients.join(', '), // Join all recipients
    cc: "martins.kruklis@gmail.com", // Keep CC to sender
    subject: subject,
    text: text,
    attachments: []
  };

  // Add attachment if provided
  if (attachmentPath && fs.existsSync(attachmentPath)) {
    mailOptions.attachments.push({
      filename: attachmentFilename || path.basename(attachmentPath),
      path: attachmentPath
    });
  }

  // Send the email
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${recipients.length} recipient(s): ${info.messageId}`);
    console.log(`Recipients: ${recipients.join(', ')}`);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

export default sendEmail;