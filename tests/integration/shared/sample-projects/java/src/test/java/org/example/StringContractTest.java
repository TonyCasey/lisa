package org.example;

import org.example.contracts.ComparableContract;

public class StringContractTest implements ComparableContract<String> {

    @Override
    public String createValue() {
        return "titi";
    }

    @Override
    public String createSmallerValue() {
        return "abc";
    }

    @Override
    public String createDifferentValue() {
        return "toto";
    }

}
