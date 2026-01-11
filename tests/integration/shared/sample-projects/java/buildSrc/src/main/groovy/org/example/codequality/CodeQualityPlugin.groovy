package org.example.codequality

import net.ltgt.gradle.apt.AptPlugin
import net.ltgt.gradle.errorprone.ErrorPronePlugin
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.tasks.compile.JavaCompile

class CodeQualityPlugin implements Plugin<Project> {

    @Override
    void apply(Project project) {
        CodeQualityExtension ext = project.extensions.create('codeQuality', CodeQualityExtension)

        project.plugins.with {
            apply('java')
            apply(AptPlugin)
            apply(ErrorPronePlugin)
        }

        project.afterEvaluate {
            project.dependencies {
                compile "com.google.code.findbugs:jsr305:${ext.findbugsJSR305Version}"
                annotationProcessor "com.uber.nullaway:nullaway:${ext.nullawayVersion}"
                testAnnotationProcessor "com.uber.nullaway:nullaway:${ext.nullawayVersion}"
            }

            project.tasks.withType(JavaCompile) {
                String annotatedPackages = ext.basePackages.join(",")

                options.compilerArgs += [
                    "-Xep:NullAway:ERROR",
                    "-XepOpt:NullAway:AnnotatedPackages=$annotatedPackages"
                ]
            }
        }
    }

}
