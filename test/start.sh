#un comment for local testing
#webdriver-manager update
#webdriver-manager start -d &
#sleep 2
#./bin/isitworking "{\"logLevel\":\"verbose\",\"waitforTimeout\":15000,\"desiredCapabilities\":[{\"browserName\":\"chrome\"}]}"

./bin/isitworking "{\"protocol\":\"https\",\"port\":\"443\",\"host\":\"ondemand.saucelabs.com\",\"user\":\"$SAUCE_USERNAME\",\"key\":\"$SAUCE_ACCESS_KEY\",\"updateSauceJob\":true,\"logLevel\":\"silent\",\"waitforTimeout\":15000,\"desiredCapabilities\":[{\"name\":\"IsItWorking$TRAVIS_JOB_NUMBER\",\"browserName\":\"chrome\"}]}"
