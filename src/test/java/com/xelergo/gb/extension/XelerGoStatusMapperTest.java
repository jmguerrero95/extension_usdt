package com.xelergo.gb.extension;

import com.generalbytes.batm.server.extensions.ITransactionDetails;

final class XelerGoStatusMapperTest {
    private XelerGoStatusMapperTest() {
    }

    static void run() {
        mapsSellStatusesConservatively();
        mapsBuyStatusesConservatively();
    }

    private static void mapsSellStatusesConservatively() {
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_SELL_PAYMENT_REQUESTED),
            Integer.valueOf(XelerGoStatusMapper.mapSellStatus("WAITING_DEPOSIT")),
            "WAITING_DEPOSIT should remain pending"
        );
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_SELL_PAYMENT_ARRIVING),
            Integer.valueOf(XelerGoStatusMapper.mapSellStatus("FORWARD_ACCEPTED")),
            "FORWARD_ACCEPTED should remain processing"
        );
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_SELL_PAYMENT_ARRIVED),
            Integer.valueOf(XelerGoStatusMapper.mapSellStatus("READY_FOR_PAYOUT")),
            "READY_FOR_PAYOUT should allow cash-out"
        );
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_SELL_ERROR),
            Integer.valueOf(XelerGoStatusMapper.mapSellStatus("ERROR_MANUAL_REVIEW")),
            "Manual review should be error"
        );
    }

    private static void mapsBuyStatusesConservatively() {
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_BUY_IN_PROGRESS),
            Integer.valueOf(XelerGoStatusMapper.mapBuyStatus("SEND_BROADCASTED")),
            "SEND_BROADCASTED must not be final success"
        );
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_BUY_COMPLETED),
            Integer.valueOf(XelerGoStatusMapper.mapBuyStatus("COMPLETED")),
            "COMPLETED should be success"
        );
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_BUY_ERROR),
            Integer.valueOf(XelerGoStatusMapper.mapBuyStatus("ERROR_MANUAL_REVIEW")),
            "Manual review should be error"
        );
        TestSupport.assertEquals(
            Integer.valueOf(ITransactionDetails.STATUS_BUY_CANCELED),
            Integer.valueOf(XelerGoStatusMapper.mapBuyStatus("CANCELED")),
            "Canceled should stay canceled"
        );
    }
}
