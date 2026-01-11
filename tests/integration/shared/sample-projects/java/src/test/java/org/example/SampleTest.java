package org.example;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

public class SampleTest {

    /**
     * Sample single test.
     */
    @Test
    public void hello_should_be_nice() {
        assertThat("Hello!").endsWith("!");
    }

    /**
     * Sample test factory.
     *
     * @return Dynamic tests
     */
    @TestFactory
    public Stream<DynamicTest> a_non_empty_string_must_have_a_positive_size() {
        return Stream.of("titi", "toto", "toto").map(str -> {
            return DynamicTest.dynamicTest("'" + str + "' must have a positive size", () -> {
                assertThat(str.length()).isPositive();
            });
        });
    }

}
