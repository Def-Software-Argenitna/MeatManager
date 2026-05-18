const nodemailer = require("nodemailer");

const port = Number(process.env.SMTP_PORT || 587);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  requireTLS: String(process.env.SMTP_REQUIRE_TLS || "").toLowerCase() === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify()
  .then(() => {
    console.log("SMTP_OK");
  })
  .catch((error) => {
    console.error("SMTP_FAIL", {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      message: error.message,
    });
    process.exit(1);
  });
