package com.xelergo.gb.extension;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.regex.Pattern;

import com.generalbytes.batm.server.extensions.ICryptoAddressValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class TronAddressValidator implements ICryptoAddressValidator {
    private static final Pattern TRON_ADDRESS_PATTERN = Pattern.compile("^T[1-9A-HJ-NP-Za-km-z]{33}$");
    private static final String BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    private static final int DECODED_ADDRESS_LENGTH = 25;
    private static final int PAYLOAD_LENGTH = 21;
    private static final byte TRON_MAINNET_PREFIX = 0x41;
    private static final Logger LOG = LoggerFactory.getLogger(XelerGoLogger.LOGGER_NAME);

    ValidationResult validate(String address) {
        if (address == null) {
            return ValidationResult.invalid(
                "FORMAT_VALIDATION_ONLY",
                XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED,
                "La direccion TRON es nula."
            );
        }

        String normalized = address.trim();
        if (!TRON_ADDRESS_PATTERN.matcher(normalized).matches()) {
            return ValidationResult.invalid(
                "FORMAT_VALIDATION_ONLY",
                XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED,
                "La direccion TRON no cumple el patron Base58 esperado."
            );
        }

        byte[] decoded;
        try {
            decoded = decodeBase58(normalized);
        } catch (IllegalArgumentException e) {
            return ValidationResult.invalid(
                "FORMAT_VALIDATION_ONLY",
                XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED,
                "La direccion TRON no pudo decodificarse como Base58Check: " + e.getMessage()
            );
        }

        if (decoded.length != DECODED_ADDRESS_LENGTH) {
            return ValidationResult.invalid(
                "CHECKSUM_VALIDATION_FAILED",
                XelerGoFailure.VALIDATION_TRON_ADDRESS_CHECKSUM_FAILED,
                "La direccion TRON decodificada no tiene la longitud Base58Check esperada."
            );
        }

        byte[] payload = Arrays.copyOfRange(decoded, 0, PAYLOAD_LENGTH);
        byte[] checksum = Arrays.copyOfRange(decoded, PAYLOAD_LENGTH, DECODED_ADDRESS_LENGTH);
        if (payload[0] != TRON_MAINNET_PREFIX) {
            return ValidationResult.invalid(
                "CHECKSUM_VALIDATION_FAILED",
                XelerGoFailure.VALIDATION_TRON_ADDRESS_CHECKSUM_FAILED,
                "La direccion TRON no pertenece al prefijo mainnet 0x41."
            );
        }

        byte[] expectedChecksum = checksum(payload);
        if (!Arrays.equals(checksum, expectedChecksum)) {
            return ValidationResult.invalid(
                "CHECKSUM_VALIDATION_FAILED",
                XelerGoFailure.VALIDATION_TRON_ADDRESS_CHECKSUM_FAILED,
                "La direccion TRON fallo la verificacion Base58Check."
            );
        }

        return ValidationResult.valid("CHECKSUM_VALIDATION_OK");
    }

    @Override
    public boolean isAddressValid(String address) {
        ValidationResult result = validate(address);
        if (!result.isValid()) {
            XelerGoTrace.create()
                .field("flow", "BUY")
                .field("stage", "address_validator")
                .maskedAddress("address", address)
                .field("addressValidationLevel", result.getValidationLevel())
                .field("failureClass", XelerGoFailure.VALIDATION)
                .field("failureCode", result.getFailureCode())
                .field("failureReason", result.getMessage())
                .field("approvalResult", false)
                .field("requestAttempted", false)
                .field("requestDispatched", false)
                .field("responseReceived", false)
                .field("result", "reject")
                .log(LOG, XelerGoLogger.Level.WARN);
        }
        return result.isValid();
    }

    @Override
    public boolean isPaperWalletSupported() {
        return false;
    }

    @Override
    public boolean mustBeBase58Address() {
        return true;
    }

    private static byte[] decodeBase58(String value) {
        BigInteger number = BigInteger.ZERO;
        for (int i = 0; i < value.length(); i++) {
            int digit = BASE58_ALPHABET.indexOf(value.charAt(i));
            if (digit < 0) {
                throw new IllegalArgumentException("Caracter Base58 invalido en posicion " + i + ".");
            }
            number = number.multiply(BigInteger.valueOf(58)).add(BigInteger.valueOf(digit));
        }

        byte[] raw = number.toByteArray();
        if (raw.length > 0 && raw[0] == 0) {
            raw = Arrays.copyOfRange(raw, 1, raw.length);
        }

        int leadingZeroes = 0;
        while (leadingZeroes < value.length() && value.charAt(leadingZeroes) == '1') {
            leadingZeroes++;
        }

        byte[] decoded = new byte[leadingZeroes + raw.length];
        System.arraycopy(raw, 0, decoded, leadingZeroes, raw.length);
        return decoded;
    }

    private static byte[] checksum(byte[] payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] first = digest.digest(payload);
            byte[] second = digest.digest(first);
            return Arrays.copyOf(second, 4);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 no esta disponible en esta JVM.", e);
        }
    }

    static final class ValidationResult {
        private final boolean valid;
        private final String validationLevel;
        private final String failureCode;
        private final String message;

        private ValidationResult(boolean valid, String validationLevel, String failureCode, String message) {
            this.valid = valid;
            this.validationLevel = validationLevel;
            this.failureCode = failureCode;
            this.message = message;
        }

        static ValidationResult valid(String validationLevel) {
            return new ValidationResult(true, validationLevel, null, null);
        }

        static ValidationResult invalid(String validationLevel, String failureCode, String message) {
            return new ValidationResult(false, validationLevel, failureCode, message);
        }

        boolean isValid() {
            return valid;
        }

        String getValidationLevel() {
            return validationLevel;
        }

        String getFailureCode() {
            return failureCode;
        }

        String getMessage() {
            return message;
        }
    }
}
