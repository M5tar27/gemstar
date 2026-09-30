cmake_minimum_required(VERSION 3.22.1)
project(gemstar_audio CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Oboe comes from the com.google.oboe:oboe AAR via Gradle prefab.
find_package(oboe REQUIRED CONFIG)

add_library(gemstar_audio SHARED engine.cpp)
# DSP + engine core are shared with iOS and live in android-app/native
set(GEMSTAR_NATIVE ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../native)
target_include_directories(gemstar_audio PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${GEMSTAR_NATIVE})
target_compile_options(gemstar_audio PRIVATE -O3 -ffast-math -Wall)
target_link_libraries(gemstar_audio oboe::oboe log android)
