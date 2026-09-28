package com.xelergo.gb.extension;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

final class XelerGoOrderLinkRegistry {
    private final Map<String, XelerGoOrderLink> byRid = new ConcurrentHashMap<>();
    private final Map<String, XelerGoOrderLink> byOrderId = new ConcurrentHashMap<>();
    private final Map<String, XelerGoOrderLink> byAddress = new ConcurrentHashMap<>();

    void put(XelerGoOrderLink link) {
        if (link == null) {
            return;
        }
        if (link.getCasTransactionId() != null) {
            byRid.put(link.getCasTransactionId(), link);
        }
        if (link.getOrderId() != null) {
            byOrderId.put(link.getOrderId(), link);
        }
        if (link.getDepositAddress() != null) {
            byAddress.put(link.getDepositAddress(), link);
        }
    }

    XelerGoOrderLink getByRid(String rid) {
        return rid == null ? null : byRid.get(rid);
    }

    XelerGoOrderLink getByOrderId(String orderId) {
        return orderId == null ? null : byOrderId.get(orderId);
    }

    XelerGoOrderLink getByAddress(String address) {
        return address == null ? null : byAddress.get(address);
    }

    XelerGoOrderLink syncFromCustomData(String rid, String terminalSerialNumber, Map<String, String> customData) {
        XelerGoOrderLink link = XelerGoOrderLink.fromCustomData(rid, terminalSerialNumber, customData);
        if (link != null) {
            put(link);
            return link;
        }
        if (rid != null) {
            return getByRid(rid);
        }
        return null;
    }
}
