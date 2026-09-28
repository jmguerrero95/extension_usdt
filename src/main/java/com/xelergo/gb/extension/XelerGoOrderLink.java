package com.xelergo.gb.extension;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

final class XelerGoOrderLink {
    private final String orderId;
    private final String orderType;
    private final String casTransactionId;
    private final String terminalSerialNumber;
    private final String terminalId;
    private final String configKey;
    private String depositAddress;
    private String qrPayload;
    private String expiresAt;
    private String backendStatus;
    private String backendRequestId;
    private String customerDestinationAddress;
    private String txid;
    private BigDecimal cryptoAmountExpected;
    private BigDecimal cryptoAmountReceived;
    private BigDecimal cryptoAmountToSend;

    XelerGoOrderLink(
        String orderId,
        String orderType,
        String casTransactionId,
        String terminalSerialNumber,
        String terminalId,
        String configKey
    ) {
        this.orderId = orderId;
        this.orderType = orderType;
        this.casTransactionId = casTransactionId;
        this.terminalSerialNumber = terminalSerialNumber;
        this.terminalId = terminalId;
        this.configKey = configKey;
    }

    String getOrderId() {
        return orderId;
    }

    String getOrderType() {
        return orderType;
    }

    String getCasTransactionId() {
        return casTransactionId;
    }

    String getTerminalSerialNumber() {
        return terminalSerialNumber;
    }

    String getTerminalId() {
        return terminalId;
    }

    String getConfigKey() {
        return configKey;
    }

    String getDepositAddress() {
        return depositAddress;
    }

    void setDepositAddress(String depositAddress) {
        this.depositAddress = depositAddress;
    }

    String getQrPayload() {
        return qrPayload;
    }

    void setQrPayload(String qrPayload) {
        this.qrPayload = qrPayload;
    }

    String getExpiresAt() {
        return expiresAt;
    }

    void setExpiresAt(String expiresAt) {
        this.expiresAt = expiresAt;
    }

    String getBackendStatus() {
        return backendStatus;
    }

    void setBackendStatus(String backendStatus) {
        this.backendStatus = backendStatus;
    }

    String getBackendRequestId() {
        return backendRequestId;
    }

    void setBackendRequestId(String backendRequestId) {
        this.backendRequestId = backendRequestId;
    }

    String getCustomerDestinationAddress() {
        return customerDestinationAddress;
    }

    void setCustomerDestinationAddress(String customerDestinationAddress) {
        this.customerDestinationAddress = customerDestinationAddress;
    }

    String getTxid() {
        return txid;
    }

    void setTxid(String txid) {
        this.txid = txid;
    }

    BigDecimal getCryptoAmountExpected() {
        return cryptoAmountExpected;
    }

    void setCryptoAmountExpected(BigDecimal cryptoAmountExpected) {
        this.cryptoAmountExpected = cryptoAmountExpected;
    }

    BigDecimal getCryptoAmountReceived() {
        return cryptoAmountReceived;
    }

    void setCryptoAmountReceived(BigDecimal cryptoAmountReceived) {
        this.cryptoAmountReceived = cryptoAmountReceived;
    }

    BigDecimal getCryptoAmountToSend() {
        return cryptoAmountToSend;
    }

    void setCryptoAmountToSend(BigDecimal cryptoAmountToSend) {
        this.cryptoAmountToSend = cryptoAmountToSend;
    }

    Map<String, String> toCustomData() {
        Map<String, String> customData = new LinkedHashMap<>();
        customData.put("xelergo.orderId", orderId);
        customData.put("xelergo.type", orderType);
        customData.put("xelergo.casTransactionId", casTransactionId);
        customData.put("xelergo.configKey", configKey);
        if (terminalSerialNumber != null) {
            customData.put("xelergo.terminalSerialNumber", terminalSerialNumber);
        }
        if (terminalId != null) {
            customData.put("xelergo.terminalId", terminalId);
        }
        if (depositAddress != null) {
            customData.put("xelergo.depositAddress", depositAddress);
        }
        if (qrPayload != null) {
            customData.put("xelergo.qrPayload", qrPayload);
        }
        if (expiresAt != null) {
            customData.put("xelergo.expiresAt", expiresAt);
        }
        if (backendStatus != null) {
            customData.put("xelergo.backendStatus", backendStatus);
        }
        if (backendRequestId != null) {
            customData.put("xelergo.backendRequestId", backendRequestId);
        }
        if (customerDestinationAddress != null) {
            customData.put("xelergo.customerDestinationAddress", customerDestinationAddress);
        }
        if (txid != null) {
            customData.put("xelergo.txid", txid);
        }
        if (cryptoAmountExpected != null) {
            customData.put("xelergo.cryptoAmountExpected", cryptoAmountExpected.toPlainString());
        }
        if (cryptoAmountReceived != null) {
            customData.put("xelergo.cryptoAmountReceived", cryptoAmountReceived.toPlainString());
        }
        if (cryptoAmountToSend != null) {
            customData.put("xelergo.cryptoAmountToSend", cryptoAmountToSend.toPlainString());
        }
        return customData;
    }

    static XelerGoOrderLink fromCustomData(String casTransactionId, String terminalSerialNumber, Map<String, String> customData) {
        if (customData == null) {
            return null;
        }
        String orderId = customData.get("xelergo.orderId");
        String orderType = customData.get("xelergo.type");
        if (orderId == null || orderType == null) {
            return null;
        }
        XelerGoOrderLink link = new XelerGoOrderLink(
            orderId,
            orderType,
            customData.get("xelergo.casTransactionId") == null ? casTransactionId : customData.get("xelergo.casTransactionId"),
            customData.get("xelergo.terminalSerialNumber") == null ? terminalSerialNumber : customData.get("xelergo.terminalSerialNumber"),
            customData.get("xelergo.terminalId"),
            customData.get("xelergo.configKey")
        );
        link.setDepositAddress(customData.get("xelergo.depositAddress"));
        link.setQrPayload(customData.get("xelergo.qrPayload"));
        link.setExpiresAt(customData.get("xelergo.expiresAt"));
        link.setBackendStatus(customData.get("xelergo.backendStatus"));
        link.setBackendRequestId(customData.get("xelergo.backendRequestId"));
        link.setCustomerDestinationAddress(customData.get("xelergo.customerDestinationAddress"));
        link.setTxid(customData.get("xelergo.txid"));
        link.setCryptoAmountExpected(decimal(customData.get("xelergo.cryptoAmountExpected")));
        link.setCryptoAmountReceived(decimal(customData.get("xelergo.cryptoAmountReceived")));
        link.setCryptoAmountToSend(decimal(customData.get("xelergo.cryptoAmountToSend")));
        return link;
    }

    private static BigDecimal decimal(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        return new BigDecimal(value);
    }
}
