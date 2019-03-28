// @flow

import invariant from "invariant";
import { BigNumber } from "bignumber.js";
import { FeeNotLoaded, InvalidAddress } from "@ledgerhq/errors";
import type { TokenAccount, Account } from "../types";
import { isValidRecipient } from "./isValidRecipient";
import { bigNumberToLibcoreAmount } from "./buildBigNumber";
import type {
  Core,
  CoreCurrency,
  CoreAccount,
  CoreBitcoinLikeTransaction,
  CoreEthereumLikeTransaction
} from "./types";

export type Transaction = {
  recipient: string,
  amount: ?(BigNumber | string),
  useAllAmount?: boolean,
  // bitcoin
  feePerByte?: ?(BigNumber | string),
  // ethereum
  gasPrice?: BigNumber | string,
  gasLimit?: BigNumber | string
};

export async function bitcoin({
  account,
  core,
  coreAccount,
  coreCurrency,
  transaction,
  isPartial,
  isCancelled
}: {
  account: Account,
  core: Core,
  coreAccount: CoreAccount,
  coreCurrency: CoreCurrency,
  transaction: Transaction,
  isPartial: boolean,
  isCancelled: () => boolean
}): Promise<?CoreBitcoinLikeTransaction> {
  const bitcoinLikeAccount = await coreAccount.asBitcoinLikeAccount();

  const isValid = await isValidRecipient({
    currency: account.currency,
    recipient: transaction.recipient
  });

  if (isValid !== null) {
    throw new InvalidAddress("", { currencyName: account.currency.name });
  }

  const { feePerByte } = transaction;
  if (!feePerByte) throw new FeeNotLoaded();

  const fees = await bigNumberToLibcoreAmount(
    core,
    coreCurrency,
    BigNumber(feePerByte)
  );
  if (isCancelled()) return;
  const transactionBuilder = await bitcoinLikeAccount.buildTransaction(
    isPartial
  );
  if (isCancelled()) return;

  if (transaction.useAllAmount) {
    await transactionBuilder.wipeToAddress(transaction.recipient);
    if (isCancelled()) return;
  } else {
    if (!transaction.amount) throw new Error("amount is missing");
    const amount = await bigNumberToLibcoreAmount(
      core,
      coreCurrency,
      BigNumber(transaction.amount)
    );
    if (isCancelled()) return;
    await transactionBuilder.sendToAddress(amount, transaction.recipient);
    if (isCancelled()) return;
  }

  await transactionBuilder.pickInputs(0, 0xffffff);
  if (isCancelled()) return;

  await transactionBuilder.setFeesPerByte(fees);
  if (isCancelled()) return;

  const builded = await transactionBuilder.build();
  if (isCancelled()) return;

  return builded;
}

const ethereumTransferMethodID = Buffer.from("a9059cbb", "hex");

export async function ethereum({
  account,
  tokenAccount,
  core,
  coreAccount,
  coreCurrency,
  transaction,
  isCancelled
}: {
  account: Account,
  tokenAccount: ?TokenAccount,
  core: Core,
  coreAccount: CoreAccount,
  coreCurrency: CoreCurrency,
  transaction: Transaction,
  isPartial: boolean,
  isCancelled: () => boolean
}): Promise<?CoreEthereumLikeTransaction> {
  const ethereumLikeAccount = await coreAccount.asEthereumLikeAccount();

  const isValid = await isValidRecipient({
    currency: account.currency,
    recipient: transaction.recipient
  });

  if (isValid !== null) {
    throw new InvalidAddress("", { currencyName: account.currency.name });
  }

  const { gasPrice, gasLimit } = transaction;
  if (!gasPrice || !gasLimit) throw new FeeNotLoaded();

  const gasPriceAmount = await bigNumberToLibcoreAmount(
    core,
    coreCurrency,
    BigNumber(gasPrice)
  );
  const gasLimitAmount = await bigNumberToLibcoreAmount(
    core,
    coreCurrency,
    BigNumber(gasLimit)
  );

  if (isCancelled()) return;
  const transactionBuilder = await ethereumLikeAccount.buildTransaction();
  if (isCancelled()) return;

  if (tokenAccount) {
    const { balance, token } = tokenAccount;
    const amount = transaction.useAllAmount
      ? balance
      : BigNumber(transaction.amount);
    const to256 = Buffer.concat([
      Buffer.alloc(12),
      Buffer.from(transaction.recipient.replace("0x", ""), "hex")
    ]);
    invariant(to256.length === 32, "recipient is invalid");
    const amountHex = amount.toString(16);
    const amountBuf = Buffer.from(
      amountHex.length % 2 === 0 ? amountHex : "0" + amountHex,
      "hex"
    );
    const amount256 = Buffer.concat([
      Buffer.alloc(32 - amountBuf.length),
      amountBuf
    ]);
    const data = Buffer.concat([ethereumTransferMethodID, to256, amount256]);

    await transactionBuilder.setInputData(data.toString("hex"));

    const zeroAmount = await bigNumberToLibcoreAmount(
      core,
      coreCurrency,
      BigNumber(0)
    );
    await transactionBuilder.sendToAddress(zeroAmount, token.contractAddress);
  } else {
    if (transaction.useAllAmount) {
      await transactionBuilder.wipeToAddress(transaction.recipient);
      if (isCancelled()) return;
    } else {
      if (!transaction.amount) throw new Error("amount is missing");
      const amount = await bigNumberToLibcoreAmount(
        core,
        coreCurrency,
        BigNumber(transaction.amount)
      );
      if (isCancelled()) return;
      await transactionBuilder.sendToAddress(amount, transaction.recipient);
      if (isCancelled()) return;
    }
  }

  await transactionBuilder.setGasLimit(gasLimitAmount);
  if (isCancelled()) return;

  await transactionBuilder.setGasPrice(gasPriceAmount);
  if (isCancelled()) return;

  const builded = await transactionBuilder.build();
  if (isCancelled()) return;

  return builded;
}

const byFamily = {
  bitcoin,
  ethereum
};

export default (opts: *) => byFamily[opts.account.currency.family](opts);
