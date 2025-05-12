// sendMail.js
import nodemailer from "nodemailer";
import fs from 'fs';

async function sendEmail(subject, text, attachmentPath, attachmentFilename) {
  // Create email transporter
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "martins.kruklis@gmail.com",
      pass: "eoao goty nnvf okrp"
    }
  });

  // Prepare email options
  const mailOptions = {
    from: '"Cadastral Checker" <martins.kruklis@gmail.com>',
    to: "rudolfs.kruklis@gmail.com",
    cc: "martins.kruklis@gmail.com",
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
    console.log(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

export default sendEmail;