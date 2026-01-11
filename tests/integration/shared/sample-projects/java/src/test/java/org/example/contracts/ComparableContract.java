package org.example.contracts;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

public interface ComparableContract<T extends Comparable<T>> extends EqualityContract<T> {

    T createSmallerValue();

    @Test
    default void comparison_should_return_zero_when_compared_to_same_instance() {
        T instance = createValue();
        assertThat(instance).isEqualByComparingTo(instance);
    }

    @Test
    default void comparison_should_return_zero_when_compared_to_itself() {
        T instance = createValue();
        T other = createValue();
        assertThat(instance).isEqualByComparingTo(other);
    }

    @Test
    default void comparison_should_return_positive_number_when_comparing_value_against_smaller_value() {
        T instance = createValue();
        T other = createSmallerValue();
        assertThat(instance.compareTo(other)).isPositive();
    }

    @Test
    default void comparison_should_return_negative_number_when_comparing_value_against_greater_value() {
        T instance = createValue();
        T other = createSmallerValue();
        assertThat(other.compareTo(instance)).isNegative();
    }

}
