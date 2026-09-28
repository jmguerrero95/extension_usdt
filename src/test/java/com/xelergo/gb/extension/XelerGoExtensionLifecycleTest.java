package com.xelergo.gb.extension;

final class XelerGoExtensionLifecycleTest {
    private XelerGoExtensionLifecycleTest() {
    }

    static void run() {
        attemptsSellPayoutOnlyWhenReadyForPayout();
    }

    private static void attemptsSellPayoutOnlyWhenReadyForPayout() {
        XelerGoOrderLink readyLink = new XelerGoOrderLink("ord_1", "SELL", "rid-1", "term-1", "batm-001", "cfg-1");
        readyLink.setBackendStatus("READY_FOR_PAYOUT");
        TestSupport.assertTrue(
            XelerGoExtension.shouldAttemptCompleteSellPayout(readyLink, true),
            "Debe intentar complete-payout solo cuando la orden SELL ya esta READY_FOR_PAYOUT"
        );

        XelerGoOrderLink completedLink = new XelerGoOrderLink("ord_2", "SELL", "rid-2", "term-1", "batm-001", "cfg-1");
        completedLink.setBackendStatus("COMPLETED");
        TestSupport.assertTrue(
            !XelerGoExtension.shouldAttemptCompleteSellPayout(completedLink, true),
            "No debe intentar cerrar de nuevo una SELL ya completada"
        );

        XelerGoOrderLink waitingLink = new XelerGoOrderLink("ord_3", "SELL", "rid-3", "term-1", "batm-001", "cfg-1");
        waitingLink.setBackendStatus("SWEEP_CONFIRMED");
        TestSupport.assertTrue(
            !XelerGoExtension.shouldAttemptCompleteSellPayout(waitingLink, true),
            "No debe marcar exito final con estados intermedios"
        );
    }
}
