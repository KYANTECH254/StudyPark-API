const prisma = require('../db');

const DARAJA_BASE_URL = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke'
};

const PLAN_TYPES = new Set(['FREE', 'MONTHLY_PREMIUM', 'ANNUAL_PREMIUM', 'LIFETIME']);

function normalizePlanType(value, fallback = 'MONTHLY_PREMIUM') {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!PLAN_TYPES.has(normalized) || normalized === 'FREE') {
    return fallback;
  }

  return normalized;
}

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (digits.startsWith('0') && digits.length === 10) {
    return `254${digits.slice(1)}`;
  }

  if (digits.startsWith('254') && digits.length === 12) {
    return digits;
  }

  if (digits.startsWith('7') && digits.length === 9) {
    return `254${digits}`;
  }

  return digits;
}

function buildPassword(shortCode, passkey, timestamp) {
  return Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');
}

function buildTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hour}${minute}${second}`;
}

function calculateEndDate(planType, startDate = new Date()) {
  if (planType === 'MONTHLY_PREMIUM') {
    return new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  if (planType === 'ANNUAL_PREMIUM') {
    return new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
  }

  return null;
}

async function ensureAppSettings() {
  return prisma.appSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' }
  });
}

function readCallbackMetadataItem(items, name) {
  return items.find((item) => item.Name === name)?.Value;
}

async function activateSubscriptionFromPayment(payment, tx) {
  const planType = normalizePlanType(payment.planType);
  const startDate = new Date();
  const endDate = calculateEndDate(planType, startDate);

  await tx.subscription.updateMany({
    where: {
      userId: payment.userId,
      status: 'ACTIVE'
    },
    data: {
      status: 'EXPIRED'
    }
  });

  const existingSubscription = await tx.subscription.findFirst({
    where: { paymentId: payment.id }
  });

  if (existingSubscription) {
    await tx.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        planType,
        status: 'ACTIVE',
        startDate,
        endDate
      }
    });
  } else {
    await tx.subscription.create({
      data: {
        userId: payment.userId,
        paymentId: payment.id,
        planType,
        status: 'ACTIVE',
        startDate,
        endDate
      }
    });
  }

  await tx.user.update({
    where: { id: payment.userId },
    data: {
      isPremium: true,
      planType
    }
  });
}

async function getStkConfig() {
  const settings = await ensureAppSettings();
  const environment = settings.stkEnvironment === 'production' ? 'production' : 'sandbox';
  const shortCodeType = String(settings.stkShortCodeType || 'paybill').toLowerCase() === 'till'
    ? 'till'
    : 'paybill';

  return {
    environment,
    shortCodeType,
    businessShortCode: String(settings.stkBusinessShortCode || '').trim(),
    accountReference: String(settings.stkAccountReference || '').trim(),
    passkey: String(settings.stkPasskey || '').trim(),
    consumerKey: String(settings.stkConsumerKey || '').trim(),
    consumerSecret: String(settings.stkConsumerSecret || '').trim(),
    callbackUrl: String(settings.stkCallbackUrl || '').trim()
  };
}

async function getDarajaAccessToken(config) {
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const response = await fetch(
    `${DARAJA_BASE_URL[config.environment]}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`
      }
    }
  );

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.errorMessage || data?.error_description || 'Unable to get M-Pesa access token');
  }

  return data.access_token;
}

async function sendStkPush(payload, config) {
  const accessToken = await getDarajaAccessToken(config);
  const response = await fetch(`${DARAJA_BASE_URL[config.environment]}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ResponseCode !== '0') {
    throw new Error(data?.errorMessage || data?.CustomerMessage || data?.ResponseDescription || 'Unable to initiate STK push');
  }

  return data;
}

class SubscriptionController {
  async getSubscription(req, res) {
    try {
      const userId = req.userId;

      const subscription = await prisma.subscription.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });

      res.json({ success: true, subscription });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async create(req, res) {
    try {
      const userId = req.userId;
      const planType = normalizePlanType(req.body?.planType);
      const { paymentId, endDate } = req.body;

      const existingSub = await prisma.subscription.findFirst({
        where: { userId, status: 'ACTIVE' }
      });

      if (existingSub) {
        return res.status(400).json({ success: false, message: 'You already have an active subscription' });
      }

      const subscription = await prisma.subscription.create({
        data: {
          userId,
          planType,
          endDate: endDate || calculateEndDate(planType),
          ...(paymentId && { paymentId })
        }
      });

      await prisma.user.update({
        where: { id: userId },
        data: { isPremium: true, planType }
      });

      res.status(201).json({ success: true, subscription });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async cancel(req, res) {
    try {
      const userId = req.userId;

      const subscription = await prisma.subscription.findFirst({
        where: { userId, status: 'ACTIVE' }
      });

      if (!subscription) {
        return res.status(404).json({ success: false, message: 'No active subscription found' });
      }

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED' }
      });

      await prisma.user.update({
        where: { id: userId },
        data: { isPremium: false, planType: 'FREE' }
      });

      res.json({ success: true, message: 'Subscription cancelled successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async createPayment(req, res) {
    try {
      const userId = req.userId;
      const {
        amount,
        currency,
        method,
        transactionId,
        planType,
        phoneNumber,
        accountReference
      } = req.body;

      if (!amount || !method) {
        return res.status(400).json({ success: false, message: 'Amount and method are required' });
      }

      const normalizedMethod = String(method).trim().toUpperCase();
      const normalizedPlanType = normalizePlanType(planType);

      if (normalizedMethod !== 'MPESA') {
        const payment = await prisma.payment.create({
          data: {
            userId,
            amount: Number(amount),
            currency: currency || 'KES',
            method: normalizedMethod,
            status: 'PENDING',
            transactionId,
            planType: normalizedPlanType
          }
        });

        return res.status(201).json({ success: true, payment });
      }

      const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
      if (!normalizedPhoneNumber || normalizedPhoneNumber.length !== 12) {
        return res.status(400).json({ success: false, message: 'A valid M-Pesa phone number is required' });
      }

      const stkConfig = await getStkConfig();
      if (
        !stkConfig.businessShortCode ||
        !stkConfig.passkey ||
        !stkConfig.consumerKey ||
        !stkConfig.consumerSecret ||
        !stkConfig.callbackUrl
      ) {
        return res.status(400).json({
          success: false,
          message: 'STK Push credentials are incomplete. Update them in admin settings first.'
        });
      }

      const payment = await prisma.payment.create({
        data: {
          userId,
          amount: Number(amount),
          currency: currency || 'KES',
          method: 'MPESA',
          status: 'PENDING',
          transactionId: transactionId || null,
          planType: normalizedPlanType,
          phoneNumber: normalizedPhoneNumber,
          accountReference: String(accountReference || stkConfig.accountReference || normalizedPlanType).trim(),
          shortCodeType: stkConfig.shortCodeType
        }
      });

      try {
        const timestamp = buildTimestamp();
        const payload = {
          BusinessShortCode: stkConfig.businessShortCode,
          Password: buildPassword(stkConfig.businessShortCode, stkConfig.passkey, timestamp),
          Timestamp: timestamp,
          TransactionType:
            stkConfig.shortCodeType === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
          Amount: Math.round(Number(amount)),
          PartyA: normalizedPhoneNumber,
          PartyB: stkConfig.businessShortCode,
          PhoneNumber: normalizedPhoneNumber,
          CallBackURL: stkConfig.callbackUrl,
          AccountReference: String(accountReference || stkConfig.accountReference || normalizedPlanType).trim(),
          TransactionDesc: `StudyPark ${normalizedPlanType}`
        };

        const stkResponse = await sendStkPush(payload, stkConfig);
        const updatedPayment = await prisma.payment.update({
          where: { id: payment.id },
          data: {
            checkoutRequestId: stkResponse.CheckoutRequestID || null,
            merchantRequestId: stkResponse.MerchantRequestID || null,
            resultDesc: stkResponse.CustomerMessage || stkResponse.ResponseDescription || null
          }
        });

        return res.status(201).json({
          success: true,
          payment: updatedPayment,
          checkoutRequestId: stkResponse.CheckoutRequestID,
          merchantRequestId: stkResponse.MerchantRequestID,
          customerMessage: stkResponse.CustomerMessage || stkResponse.ResponseDescription
        });
      } catch (error) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            resultDesc: error.message
          }
        });
        throw error;
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
  }

  async handleStkCallback(req, res) {
    try {
      const callback = req.body?.Body?.stkCallback;
      const checkoutRequestId = callback?.CheckoutRequestID;

      if (!checkoutRequestId) {
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received without checkout request ID' });
      }

      const payment = await prisma.payment.findFirst({
        where: { checkoutRequestId }
      });

      if (!payment) {
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received' });
      }

      const resultCode = Number(callback.ResultCode || 1);
      const metadataItems = callback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = readCallbackMetadataItem(metadataItems, 'MpesaReceiptNumber');
      const callbackPhoneNumber = readCallbackMetadataItem(metadataItems, 'PhoneNumber');
      const callbackAmount = readCallbackMetadataItem(metadataItems, 'Amount');

      await prisma.$transaction(async (tx) => {
        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: resultCode === 0 ? 'SUCCESS' : 'FAILED',
            transactionId: mpesaReceiptNumber || payment.transactionId,
            mpesaReceiptNumber: mpesaReceiptNumber || null,
            phoneNumber: callbackPhoneNumber ? String(callbackPhoneNumber) : payment.phoneNumber,
            amount: callbackAmount ? Number(callbackAmount) : payment.amount,
            resultCode,
            resultDesc: callback.ResultDesc || null
          }
        });

        if (resultCode === 0) {
          await activateSubscriptionFromPayment(updatedPayment, tx);
        }
      });

      res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (error) {
      console.error(error);
      res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted with processing error' });
    }
  }

  async updatePaymentStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, transactionId, planType } = req.body;

      const payment = await prisma.payment.update({
        where: { id },
        data: {
          status,
          transactionId: transactionId || undefined,
          planType: planType ? normalizePlanType(planType) : undefined
        }
      });

      if (status === 'SUCCESS') {
        await prisma.$transaction(async (tx) => {
          await activateSubscriptionFromPayment(payment, tx);
        });
      }

      res.json({ success: true, payment });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  async getPayments(req, res) {
    try {
      const userId = req.userId;
      const payments = await prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      res.json({ success: true, payments });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
}

module.exports = new SubscriptionController();
