cmake_minimum_required(VERSION 3.10)
project(VCFEngine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 配置編譯優化
if(MSVC)
    add_compile_options(/O2 /Oi /Ot /GL)
else()
    add_compile_options(-O3 -march=native)
endif()

find_package(Threads REQUIRED)

# 包含目錄
include_directories(.)

# ── engine.exe ────────────────────────────────────────────────
add_executable(engine
    Main.cpp
    Board.h
    Constants.h
    Evaluator.h
    Evaluator.cpp
    Searcher.h
    Searcher.cpp
)

target_link_libraries(engine Threads::Threads)

add_custom_command(TARGET engine POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/engine_node.js"
        "$<TARGET_FILE_DIR:engine>/engine_node.js"
)

# ── host.exe (WebView2 GUI) ───────────────────────────────────
# 需要 WebView2 SDK：
#   PowerShell> nuget install Microsoft.Web.WebView2 -OutputDirectory C:\wv2sdk
# 然後設定 WV2_SDK，例如：
#   cmake ... -DWV2_SDK="C:/wv2sdk/Microsoft.Web.WebView2.x.y.z"
set(WV2_SDK "" CACHE PATH "Microsoft.Web.WebView2 NuGet 解壓目錄")

if(WV2_SDK)
    add_executable(host WIN32 host.cpp)

    target_include_directories(host PRIVATE
        "${WV2_SDK}/build/native/include"
        "."
    )
    target_link_libraries(host PRIVATE
        "${WV2_SDK}/build/native/x64/WebView2LoaderStatic.lib"
        ole32 oleaut32 shlwapi version
    )
    set_target_properties(host PROPERTIES
        LINK_FLAGS "/SUBSYSTEM:WINDOWS"
    )
    message(STATUS "host.exe 目標已啟用，使用 WebView2 SDK: ${WV2_SDK}")
else()
    message(STATUS "跳過 host.exe（未設定 WV2_SDK）")
endif()
