import axios from "axios";
import crypto from "crypto";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import FeePayments from "../models/feePayments.js";
import FeeReminderNotification from "../models/feeReminderNotification.js";

// Environment variables
const {
  PHONEPE_MERCHANT_ID,
  PHONEPE_SALT_KEY,
  PHONEPE_SALT_INDEX,
  PHONEPE_SANDBOX_URL
} = process.env;

// Initiate payment
export const initiatePayment = async (req, res) => {
  try {
    const { feePaymentId, mobileNumber, parentId } = req.body;
    const feePayment = await FeePayments.findById(feePaymentId).populate(
      "feesGroupId feesTypeId studentId"
    );
    if (!feePayment) {
      return res.status(404).json({ message: "Fee payment not found" });
    }
    if (feePayment.status === "Paid") {
      return res.status(400).json({ message: "Fee already paid" });
    }

    const amount = feePayment.amountDue - feePayment.amountPaid;
    const merchantTransactionId = `MT${Date.now()}`;
    const payload = {
      merchantId: PHONEPE_MERCHANT_ID,
      merchantTransactionId,
      merchantUserId: `MUID${parentId}`,
      amount: Math.round(amount * 100), // INR to paisa
      redirectUrl: `http://localhost:5000/api/feesPayment/payment/status`,
      redirectMode: "POST",
      callbackUrl: `http://localhost:5000/api/feesPayment/payment/callback`,
      mobileNumber: mobileNumber || "9999999999",
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const payloadStr = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadStr).toString("base64");
    const string = payloadBase64 + "/pg/v1/pay" + PHONEPE_SALT_KEY;
    const sha256 = crypto.createHash("sha256").update(string).digest("hex");
    const checksum = sha256 + "###" + PHONEPE_SALT_INDEX;

    const response = await axios.post(
      `${PHONEPE_SANDBOX_URL}/pg/v1/pay`,
      { request: payloadBase64 },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": checksum,
          accept: "application/json"
        }
      }
    );

    feePayment.merchantTransactionId = merchantTransactionId;
    feePayment.transactionStatus = "PENDING";
    await feePayment.save();

    res.json({
      paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
      merchantTransactionId
    });
  } catch (error) {
    console.error("Initiate payment error:", error.message);
    res.status(500).json({ message: "Payment initiation failed" });
  }
};

// Handle callback
export const handleCallback = async (req, res) => {
  try {
    const { merchantTransactionId, responseCode } = req.body;
    const feePayment = await FeePayments.findOne({ merchantTransactionId }).populate(
      "feesGroupId feesTypeId studentId"
    );
    if (!feePayment) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (responseCode === "PAYMENT_SUCCESS") {
      feePayment.amountPaid = feePayment.amountDue;
      feePayment.status = "Paid";
      feePayment.paymentDate = new Date();
      feePayment.transactionStatus = "SUCCESS";
      feePayment.receiptUrl = await generateReceipt(feePayment);
      await feePayment.save();

      const notification = new FeeReminderNotification({
        recipientId: feePayment.studentId, // Replace with parentId if available
        recipientType: "student",
        title: "Payment Confirmation",
        message: `Payment of ₹${feePayment.amountDue / 100} for ${feePayment.feesTypeId.name} successful.`,
        feePaymentId: feePayment._id,
        dueDate: feePayment.dueDate,
        amountDue: feePayment.amountDue,
        status: "unread"
      });
      await notification.save();
    } else {
      feePayment.transactionStatus = "FAILED";
      await feePayment.save();
    }

    res.status(200).json({ message: "Callback processed" });
  } catch (error) {
    console.error("Callback error:", error.message);
    res.status(500).json({ message: "Callback processing failed" });
  }
};

// Check payment status
export const checkStatus = async (req, res) => {
  try {
    const { merchantTransactionId } = req.params;
    const feePayment = await FeePayments.findOne({ merchantTransactionId }).populate(
      "feesGroupId feesTypeId studentId"
    );
    if (!feePayment) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    const string = `/pg/v1/status/${PHONEPE_MERCHANT_ID}/${merchantTransactionId}${PHONEPE_SALT_KEY}`;
    const sha256 = crypto.createHash("sha256").update(string).digest("hex");
    const checksum = sha256 + "###" + PHONEPE_SALT_INDEX;

    const response = await axios.get(
      `${PHONEPE_SANDBOX_URL}/pg/v1/status/${PHONEPE_MERCHANT_ID}/${merchantTransactionId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": checksum,
          "X-MERCHANT-ID": PHONEPE_MERCHANT_ID,
          accept: "application/json"
        }
      }
    );

    const { code, data } = response.data;
    if (code === "PAYMENT_SUCCESS") {
      feePayment.amountPaid = feePayment.amountDue;
      feePayment.status = "Paid";
      feePayment.paymentDate = new Date();
      feePayment.transactionStatus = "SUCCESS";
      feePayment.paymentMethod = data.paymentInstrument?.type || "UNKNOWN";
      feePayment.receiptUrl = await generateReceipt(feePayment);
      await feePayment.save();

      const notification = new FeeReminderNotification({
        recipientId: feePayment.studentId,
        recipientType: "student",
        title: "Payment Confirmation",
        message: `Payment of ₹${feePayment.amountDue / 100} for ${feePayment.feesTypeId.name} successful.`,
        feePaymentId: feePayment._id,
        dueDate: feePayment.dueDate,
        amountDue: feePayment.amountDue,
        status: "unread"
      });
      await notification.save();
    } else {
      feePayment.transactionStatus = code === "PAYMENT_ERROR" ? "FAILED" : "PENDING";
      await feePayment.save();
    }

    res.json({ status: feePayment.transactionStatus, feePayment });
  } catch (error) {
    console.error("Status check error:", error.message);
    res.status(500).json({ message: "Status check failed" });
  }
};

// Generate PDF receipt
const generateReceipt = async (feePayment) => {
  const doc = new PDFDocument();
  const fileName = `receipt_${feePayment.merchantTransactionId}.pdf`;
  const filePath = path.join("receipts", fileName);
  fs.mkdirSync("receipts", { recursive: true });
  const stream = fs.createWriteStream(filePath);

  doc.pipe(stream);
  doc.fontSize(20).text("Payment Receipt", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Student: ${feePayment.studentId.name}`);
  doc.text(`Fee Type: ${feePayment.feesTypeId.name}`);
  doc.text(`Fee Group: ${feePayment.feesGroupId.name}`);
  doc.text(`Amount Paid: ₹${feePayment.amountPaid / 100}`);
  doc.text(`Payment Date: ${feePayment.paymentDate.toLocaleDateString()}`);
  doc.text(`Transaction ID: ${feePayment.merchantTransactionId}`);
  doc.end();

  return `/receipts/${fileName}`;
};

// Serve receipt
export const getReceipt = async (req, res) => {
  try {
    const { merchantTransactionId } = req.params;
    const feePayment = await FeePayments.findOne({ merchantTransactionId });
    if (!feePayment || !feePayment.receiptUrl) {
      return res.status(404).json({ message: "Receipt not found" });
    }

    const filePath = path.join(process.cwd(), feePayment.receiptUrl);
    res.download(filePath);
  } catch (error) {
    console.error("Receipt download error:", error.message);
    res.status(500).json({ message: "Failed to download receipt" });
  }
};