package org.example;

import com.google.common.base.Joiner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Main {

    private static final Logger LOGGER = LoggerFactory.getLogger(Main.class);

    public static void main(String... args) {
        LOGGER.info("Hello, you");
        if (args.length > 0) {
            LOGGER.debug("You provided arguments: {}", Joiner.on(", ").join(args));
        }
        LOGGER.info("End of program");
    }

}
