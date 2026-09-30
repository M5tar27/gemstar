require 'json'

Pod::Spec.new do |s|
  s.name         = 'GemstarAudio'
  s.version      = '0.1.0'
  s.summary      = 'Gemstar real-time vocal engine (shared C++ DSP + RemoteIO) and React Native bridge'
  s.homepage     = 'https://gemstaraudio.com'
  s.license      = { :type => 'Proprietary' }
  s.author       = 'M5tar Studio'
  s.platforms    = { :ios => '15.1' }
  s.source       = { :path => '.' }
  s.source_files = '*.{h,m,mm}'
  s.frameworks   = 'AudioToolbox', 'AVFoundation'

  # Shared DSP headers live in mobile/native (used by Android too).
  # -O3 in every configuration: an unoptimized Debug DSP cannot keep up in real time.
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/../../native"',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'GCC_OPTIMIZATION_LEVEL' => '3',
  }

  s.dependency 'React-Core'
end
