package com.xelergo.gb.extension;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

final class XelerGoJson {
    private XelerGoJson() {
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> parseObject(String jsonText) {
        Object parsed = parse(jsonText);
        if (!(parsed instanceof Map)) {
            throw new IllegalArgumentException("Se esperaba un objeto JSON");
        }
        return (Map<String, Object>) parsed;
    }

    static Object parse(String jsonText) {
        Objects.requireNonNull(jsonText, "jsonText");
        Parser parser = new Parser(jsonText);
        Object value = parser.parseValue();
        parser.skipWhitespace();
        if (!parser.isFinished()) {
            throw new IllegalArgumentException("JSON invalido: caracteres sobrantes");
        }
        return value;
    }

    static String stringify(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof String) {
            return "\"" + escape((String) value) + "\"";
        }
        if (value instanceof Number || value instanceof Boolean) {
            return value.toString();
        }
        if (value instanceof Map) {
            StringBuilder builder = new StringBuilder("{");
            Iterator<? extends Map.Entry<?, ?>> iterator = ((Map<?, ?>) value).entrySet().iterator();
            while (iterator.hasNext()) {
                Map.Entry<?, ?> entry = iterator.next();
                builder.append(stringify(String.valueOf(entry.getKey())))
                    .append(':')
                    .append(stringify(entry.getValue()));
                if (iterator.hasNext()) {
                    builder.append(',');
                }
            }
            return builder.append('}').toString();
        }
        if (value instanceof Collection) {
            StringBuilder builder = new StringBuilder("[");
            Iterator<?> iterator = ((Collection<?>) value).iterator();
            while (iterator.hasNext()) {
                builder.append(stringify(iterator.next()));
                if (iterator.hasNext()) {
                    builder.append(',');
                }
            }
            return builder.append(']').toString();
        }
        throw new IllegalArgumentException("Tipo no soportado para JSON: " + value.getClass().getName());
    }

    private static String escape(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\b", "\\b")
            .replace("\f", "\\f")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }

    private static final class Parser {
        private final String jsonText;
        private int index;

        private Parser(String jsonText) {
            this.jsonText = jsonText;
        }

        Object parseValue() {
            skipWhitespace();
            ensureAvailable();
            char current = jsonText.charAt(index);
            if (current == '{') {
                return parseObject();
            }
            if (current == '[') {
                return parseArray();
            }
            if (current == '"') {
                return parseString();
            }
            if (current == 't') {
                expect("true");
                return Boolean.TRUE;
            }
            if (current == 'f') {
                expect("false");
                return Boolean.FALSE;
            }
            if (current == 'n') {
                expect("null");
                return null;
            }
            return parseNumber();
        }

        Map<String, Object> parseObject() {
            Map<String, Object> result = new LinkedHashMap<>();
            expect('{');
            skipWhitespace();
            if (peek('}')) {
                expect('}');
                return result;
            }
            while (true) {
                skipWhitespace();
                String key = parseString();
                skipWhitespace();
                expect(':');
                Object value = parseValue();
                result.put(key, value);
                skipWhitespace();
                if (peek('}')) {
                    expect('}');
                    return result;
                }
                expect(',');
            }
        }

        List<Object> parseArray() {
            List<Object> result = new ArrayList<>();
            expect('[');
            skipWhitespace();
            if (peek(']')) {
                expect(']');
                return result;
            }
            while (true) {
                result.add(parseValue());
                skipWhitespace();
                if (peek(']')) {
                    expect(']');
                    return result;
                }
                expect(',');
            }
        }

        String parseString() {
            expect('"');
            StringBuilder builder = new StringBuilder();
            while (!isFinished()) {
                char current = jsonText.charAt(index++);
                if (current == '"') {
                    return builder.toString();
                }
                if (current != '\\') {
                    builder.append(current);
                    continue;
                }
                ensureAvailable();
                char escaped = jsonText.charAt(index++);
                switch (escaped) {
                    case '"':
                    case '\\':
                    case '/':
                        builder.append(escaped);
                        break;
                    case 'b':
                        builder.append('\b');
                        break;
                    case 'f':
                        builder.append('\f');
                        break;
                    case 'n':
                        builder.append('\n');
                        break;
                    case 'r':
                        builder.append('\r');
                        break;
                    case 't':
                        builder.append('\t');
                        break;
                    case 'u':
                        builder.append(parseUnicode());
                        break;
                    default:
                        throw new IllegalArgumentException("Escape JSON invalido");
                }
            }
            throw new IllegalArgumentException("Cadena JSON sin cerrar");
        }

        private char parseUnicode() {
            if (index + 4 > jsonText.length()) {
                throw new IllegalArgumentException("Escape unicode incompleto");
            }
            String hex = jsonText.substring(index, index + 4);
            index += 4;
            return (char) Integer.parseInt(hex, 16);
        }

        private BigDecimal parseNumber() {
            int start = index;
            if (peek('-')) {
                index++;
            }
            readDigits();
            if (peek('.')) {
                index++;
                readDigits();
            }
            if (peek('e') || peek('E')) {
                index++;
                if (peek('+') || peek('-')) {
                    index++;
                }
                readDigits();
            }
            return new BigDecimal(jsonText.substring(start, index));
        }

        private void readDigits() {
            int start = index;
            while (!isFinished() && Character.isDigit(jsonText.charAt(index))) {
                index++;
            }
            if (start == index) {
                throw new IllegalArgumentException("Se esperaban digitos");
            }
        }

        void skipWhitespace() {
            while (!isFinished() && Character.isWhitespace(jsonText.charAt(index))) {
                index++;
            }
        }

        boolean isFinished() {
            return index >= jsonText.length();
        }

        private boolean peek(char expected) {
            return !isFinished() && jsonText.charAt(index) == expected;
        }

        private void expect(char expected) {
            ensureAvailable();
            if (jsonText.charAt(index) != expected) {
                throw new IllegalArgumentException("Se esperaba '" + expected + "'");
            }
            index++;
        }

        private void expect(String expected) {
            if (!jsonText.startsWith(expected, index)) {
                throw new IllegalArgumentException("Se esperaba " + expected);
            }
            index += expected.length();
        }

        private void ensureAvailable() {
            if (isFinished()) {
                throw new IllegalArgumentException("JSON incompleto");
            }
        }
    }
}
