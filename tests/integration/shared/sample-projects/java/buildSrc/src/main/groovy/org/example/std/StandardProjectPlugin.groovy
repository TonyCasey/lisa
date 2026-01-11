package org.example.std

import com.github.benmanes.gradle.versions.VersionsPlugin
import org.example.codequality.CodeQualityPlugin
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.ComponentSelection
import org.gradle.api.plugins.JavaPlugin
import org.gradle.plugins.ide.idea.IdeaPlugin

class StandardProjectPlugin implements Plugin<Project> {

    @Override
    void apply(Project project) {
        StandardProjectExtension ext = project.extensions.create('standardProject', StandardProjectExtension)

        project.plugins.with {
            apply(JavaPlugin)
            apply(IdeaPlugin)
            apply(VersionsPlugin)
            apply(CodeQualityPlugin)
        }

        configureJava(project)

        project.afterEvaluate {
            configureJUnit(project, ext)
            configureDependencyUpdates(project)
        }
    }

    /**
     * Configure Java project properties.
     */
    private void configureJava(Project project) {
        project.sourceCompatibility = 1.8
        project.targetCompatibility = project.sourceCompatibility
    }

    /**
     * Use JUnit 5.
     */
    private void configureJUnit(Project project, StandardProjectExtension ext) {
        project.test {
            useJUnitPlatform {
                includeEngines 'junit-jupiter'
            }
        }

        project.dependencies {
            testCompile group: 'org.junit.jupiter', name: 'junit-jupiter-api', version: ext.junitVersion
            testRuntime group: 'org.junit.jupiter', name: 'junit-jupiter-engine', version: ext.junitVersion
        }
    }

    /**
     * Only check versions with released packages.
     */
    private void configureDependencyUpdates(Project project) {
        project.dependencyUpdates {

            resolutionStrategy = {

                componentSelection { rules ->
                    rules.all { ComponentSelection selection ->
                        boolean rejected = ['alpha', 'beta', 'rc', 'cr', 'm'].any { qualifier ->
                            selection.candidate.version ==~ /(?i).*[.-]${qualifier}[.\d-]*/
                        }
                        if (rejected) {
                            selection.reject('Release candidate')
                        }
                    }
                }

            }

        }
    }

}
