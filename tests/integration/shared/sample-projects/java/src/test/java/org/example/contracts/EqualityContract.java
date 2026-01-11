package org.example.contracts;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

public interface EqualityContract<T> extends Testable<T> {

    T createDifferentValue();

    @Test
    default void value_should_be_equal_to_same_instance() {
        T instance = createValue();
        assertThat(instance).isEqualTo(instance);
        assertThat(instance.hashCode()).isEqualTo(instance.hashCode());
    }

    @Test
    default void value_should_be_equal_to_itself() {
        T instance = createValue();
        T other = createValue();
        assertThat(instance).isEqualTo(other);
    }

    @Test
    default void value_hash_code_should_be_equal_to_itself_hash_code() {
        T instance = createValue();
        T other = createValue();
        assertThat(instance.hashCode()).isEqualTo(other.hashCode());
    }

    @Test
    default void value_should_be_equal_to_different_value() {
        T instance = createValue();
        T other = createDifferentValue();
        assertThat(instance).isNotEqualTo(other);
    }

    @Test
    default void value_should_not_be_equal_to_null() {
        T instance = createValue();
        assertThat(instance).isNotEqualTo(null);
    }

    @Test
    default void equality_algorithm_should_be_reflexive() {
        T instance = createValue();
        T other = createValue();
        assertThat(instance).isEqualTo(other);
        assertThat(other).isEqualTo(instance);
    }

}
