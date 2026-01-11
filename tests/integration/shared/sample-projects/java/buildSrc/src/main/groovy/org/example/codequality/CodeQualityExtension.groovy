package org.example.codequality

class CodeQualityExtension {

    /**
     * Version of the Uber nullaway library.
     */
    String nullawayVersion = '0.5.2'

    /**
     * JSR-305 version.
     */
    String findbugsJSR305Version = '3.0.2'

    /**
     * Base packages to inspect with the Uber nullaway library.
     */
    List<String> basePackages = []

    void basePackage(String basePackage) {
        basePackages << basePackage
    }

}
