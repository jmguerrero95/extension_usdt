package com.xelergo.gb.extension;

final class TronAddressValidatorTest {
    private static final String VALID_TRON_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    private static final String INVALID_CHECKSUM_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u";
    private static final String INVALID_FORMAT_ADDRESS = "TINVALID";

    private TronAddressValidatorTest() {
    }

    static void run() {
        TronAddressValidator validator = new TronAddressValidator();

        TronAddressValidator.ValidationResult valid = validator.validate(VALID_TRON_ADDRESS);
        TestSupport.assertTrue(valid.isValid(), "La direccion TRON valida debe pasar la verificacion.");
        TestSupport.assertEquals("CHECKSUM_VALIDATION_OK", valid.getValidationLevel(), "validationLevel valido");

        TronAddressValidator.ValidationResult checksumFailed = validator.validate(INVALID_CHECKSUM_ADDRESS);
        TestSupport.assertTrue(!checksumFailed.isValid(), "Checksum invalido debe rechazarse.");
        TestSupport.assertEquals("CHECKSUM_VALIDATION_FAILED", checksumFailed.getValidationLevel(), "validationLevel checksum");
        TestSupport.assertEquals(XelerGoFailure.VALIDATION_TRON_ADDRESS_CHECKSUM_FAILED, checksumFailed.getFailureCode(), "failureCode checksum");

        TronAddressValidator.ValidationResult formatFailed = validator.validate(INVALID_FORMAT_ADDRESS);
        TestSupport.assertTrue(!formatFailed.isValid(), "Formato invalido debe rechazarse.");
        TestSupport.assertEquals("FORMAT_VALIDATION_ONLY", formatFailed.getValidationLevel(), "validationLevel format");
        TestSupport.assertEquals(XelerGoFailure.VALIDATION_TRON_ADDRESS_FORMAT_FAILED, formatFailed.getFailureCode(), "failureCode format");
    }
}
