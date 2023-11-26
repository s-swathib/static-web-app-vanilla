import logging
import requests
import os
import sys
 
# Define subscription key and region
subscription_key = "f22920f0f7d64ce39ec6aa9ab6ca06a1"
region = "westus2"
 
def get_access_token():
    # Define token endpoint
    token_endpoint = f"https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
 
    # Make HTTP request with subscription key as header
    response = requests.post(token_endpoint, headers={"Ocp-Apim-Subscription-Key": subscription_key})
 
    if response.status_code == 200:
        return response.text
    else:
        return None
 
def main():
    logging.info('Processing a request.')
 
    access_token = get_access_token()
 
    if access_token:
        return access_token
    else:
        logging.error("Failed to retrieve access token.")
 
if __name__ == "__main__":
    main()
