package com.xelergo.gb.extension;

import com.generalbytes.batm.server.extensions.ITransactionDetails;

final class XelerGoStatusMapper {
    private XelerGoStatusMapper() {
    }

    static int mapSellStatus(String backendStatus) {
        if (backendStatus == null) {
            return ITransactionDetails.STATUS_SELL_PAYMENT_REQUESTED;
        }
        switch (backendStatus) {
            case "WAITING_DEPOSIT":
            case "CREATED":
            case "ADDRESS_ASSIGNED":
                return ITransactionDetails.STATUS_SELL_PAYMENT_REQUESTED;
            case "DEPOSIT_DETECTED":
            case "ENERGY_ESTIMATION_REQUESTED":
            case "ENERGY_ESTIMATED":
            case "ENERGY_REQUESTED":
            case "ENERGY_CONFIRMED":
            case "FORWARD_REQUESTED":
            case "FORWARD_ACCEPTED":
            case "SWEEP_CONFIRMED":
                return ITransactionDetails.STATUS_SELL_PAYMENT_ARRIVING;
            case "READY_FOR_PAYOUT":
            case "COMPLETED":
                return ITransactionDetails.STATUS_SELL_PAYMENT_ARRIVED;
            case "EXPIRED":
            case "CANCELED":
            case "ERROR_RETRYABLE":
            case "ERROR_MANUAL_REVIEW":
            case "LATE_DEPOSIT":
                return ITransactionDetails.STATUS_SELL_ERROR;
            default:
                return ITransactionDetails.STATUS_SELL_PAYMENT_REQUESTED;
        }
    }

    static int mapBuyStatus(String backendStatus) {
        if (backendStatus == null) {
            return ITransactionDetails.STATUS_BUY_IN_PROGRESS;
        }
        switch (backendStatus) {
            case "COMPLETED":
            case "DELIVERY_CONFIRMED":
                return ITransactionDetails.STATUS_BUY_COMPLETED;
            case "CANCELED":
                return ITransactionDetails.STATUS_BUY_CANCELED;
            case "ERROR_MANUAL_REVIEW":
                return ITransactionDetails.STATUS_BUY_ERROR;
            case "CREATED":
            case "VALIDATED":
            case "ENERGY_ESTIMATION_REQUESTED":
            case "ENERGY_ESTIMATED":
            case "ENERGY_REQUESTED":
            case "ENERGY_CONFIRMED":
            case "SEND_REQUESTED":
            case "SEND_ACCEPTED":
            case "SEND_BROADCASTED":
            case "READY_FOR_PAYOUT":
            case "ERROR_RETRYABLE":
                return ITransactionDetails.STATUS_BUY_IN_PROGRESS;
            default:
                return ITransactionDetails.STATUS_BUY_IN_PROGRESS;
        }
    }

    static boolean isSellTerminalState(String backendStatus) {
        return "READY_FOR_PAYOUT".equals(backendStatus)
            || "COMPLETED".equals(backendStatus)
            || "EXPIRED".equals(backendStatus)
            || "CANCELED".equals(backendStatus)
            || "ERROR_MANUAL_REVIEW".equals(backendStatus)
            || "LATE_DEPOSIT".equals(backendStatus);
    }

    static boolean isBuyTerminalState(String backendStatus) {
        return "COMPLETED".equals(backendStatus)
            || "DELIVERY_CONFIRMED".equals(backendStatus)
            || "CANCELED".equals(backendStatus)
            || "ERROR_MANUAL_REVIEW".equals(backendStatus);
    }
}
