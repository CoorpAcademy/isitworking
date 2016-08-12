#un comment for local testing
#webdriver-manager update
#webdriver-manager start -d &
#sleep 2
#./bin/isitworking "{\"logLevel\":\"verbose\",\"waitforTimeout\":15000,\"desiredCapabilities\":[{\"browserName\":\"chrome\"}]}"

./bin/isitworking "{\"user\":\"$SAUCE_USERNAME\",\"key\":\"$SAUCE_ACCESS_KEY\",\"updateSauceJob\":true,\"logLevel\":\"verbose\",\"waitforTimeout\":15000,\"desiredCapabilities\":[{\"browserName\":\"chrome\"}]}"
